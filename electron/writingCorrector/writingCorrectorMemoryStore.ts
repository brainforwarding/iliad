import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type WritingCorrectorLanguage = "en" | "es";

export interface WritingCorrectorMemorySnapshot {
  ignoredIssueFingerprints: string[];
  customWords: string[];
}

interface StoredDocumentMemory {
  workspacePath: string;
  documentRelativePath: string;
  ignoredIssueFingerprints: string[];
  updatedAt: string;
}

interface StoredDictionaryWord {
  language: WritingCorrectorLanguage;
  word: string;
  createdAt: string;
}

interface StoredWritingCorrectorMemory {
  version: 1;
  documents: StoredDocumentMemory[];
  dictionary: StoredDictionaryWord[];
}

const MAX_DOCUMENTS = 1000;
const MAX_IGNORES_PER_DOCUMENT = 500;
const MAX_DICTIONARY_WORDS = 5000;
const MAX_FINGERPRINT_LENGTH = 240;
const MAX_WORD_LENGTH = 80;

function emptyStore(): StoredWritingCorrectorMemory {
  return {
    version: 1,
    documents: [],
    dictionary: []
  };
}

function sameWorkspace(left: string, right: string) {
  return path.resolve(left) === path.resolve(right);
}

function sameDocument(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function sanitizeFingerprint(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const fingerprint = value.trim().slice(0, MAX_FINGERPRINT_LENGTH);
  return fingerprint ? fingerprint : null;
}

function sanitizeWord(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const word = value.trim().toLowerCase().slice(0, MAX_WORD_LENGTH);
  return /^[\p{L}\p{N}'-]+$/u.test(word) ? word : null;
}

function sanitizeLanguage(value: unknown): WritingCorrectorLanguage {
  return value === "es" ? "es" : "en";
}

function uniqueStrings(values: Iterable<string>, limit: number) {
  return [...new Set(values)].slice(0, limit);
}

function sanitizeStore(value: unknown): StoredWritingCorrectorMemory {
  if (!value || typeof value !== "object") {
    return emptyStore();
  }

  const candidate = value as Partial<StoredWritingCorrectorMemory>;
  const documents = Array.isArray(candidate.documents)
    ? candidate.documents
        .filter((entry): entry is StoredDocumentMemory =>
          Boolean(entry) &&
          typeof entry === "object" &&
          typeof entry.workspacePath === "string" &&
          typeof entry.documentRelativePath === "string" &&
          Array.isArray(entry.ignoredIssueFingerprints)
        )
        .map((entry) => ({
          workspacePath: entry.workspacePath,
          documentRelativePath: entry.documentRelativePath,
          ignoredIssueFingerprints: uniqueStrings(
            entry.ignoredIssueFingerprints
              .map((fingerprint) => sanitizeFingerprint(fingerprint))
              .filter((fingerprint): fingerprint is string => Boolean(fingerprint)),
            MAX_IGNORES_PER_DOCUMENT
          ),
          updatedAt:
            typeof entry.updatedAt === "string" && !Number.isNaN(Date.parse(entry.updatedAt))
              ? new Date(entry.updatedAt).toISOString()
              : new Date().toISOString()
        }))
        .filter((entry) => entry.ignoredIssueFingerprints.length > 0)
        .slice(0, MAX_DOCUMENTS)
    : [];
  const dictionary = Array.isArray(candidate.dictionary)
    ? candidate.dictionary
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }

          const word = sanitizeWord((entry as StoredDictionaryWord).word);

          if (!word) {
            return null;
          }

          return {
            language: sanitizeLanguage((entry as StoredDictionaryWord).language),
            word,
            createdAt:
              typeof (entry as StoredDictionaryWord).createdAt === "string" &&
              !Number.isNaN(Date.parse((entry as StoredDictionaryWord).createdAt))
                ? new Date((entry as StoredDictionaryWord).createdAt).toISOString()
                : new Date().toISOString()
          };
        })
        .filter((entry): entry is StoredDictionaryWord => Boolean(entry))
        .slice(0, MAX_DICTIONARY_WORDS)
    : [];

  return {
    version: 1,
    documents,
    dictionary
  };
}

export class WritingCorrectorMemoryStore {
  private readonly storePath: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(userDataPath: string) {
    this.storePath = path.join(userDataPath, "assistant", "writing-corrector-memory.json");
  }

  async getForDocument(
    workspacePath: string,
    documentRelativePath: string,
    language: WritingCorrectorLanguage
  ): Promise<WritingCorrectorMemorySnapshot> {
    return this.enqueue(async () => {
      const store = await this.readStore();
      const document = store.documents.find(
        (entry) => sameWorkspace(entry.workspacePath, workspacePath) && sameDocument(entry.documentRelativePath, documentRelativePath)
      );

      return {
        ignoredIssueFingerprints: document?.ignoredIssueFingerprints.slice() ?? [],
        customWords: store.dictionary
          .filter((entry) => entry.language === language)
          .map((entry) => entry.word)
      };
    });
  }

  async ignoreIssue(
    workspacePath: string,
    documentRelativePath: string,
    language: WritingCorrectorLanguage,
    fingerprint: unknown
  ): Promise<WritingCorrectorMemorySnapshot> {
    return this.enqueue(async () => {
      const sanitizedFingerprint = sanitizeFingerprint(fingerprint);

      if (!sanitizedFingerprint) {
        return this.snapshotFromStore(await this.readStore(), workspacePath, documentRelativePath, language);
      }

      const store = await this.readStore();
      const existing = store.documents.find(
        (entry) => sameWorkspace(entry.workspacePath, workspacePath) && sameDocument(entry.documentRelativePath, documentRelativePath)
      );
      const ignoredIssueFingerprints = uniqueStrings(
        [...(existing?.ignoredIssueFingerprints ?? []), sanitizedFingerprint],
        MAX_IGNORES_PER_DOCUMENT
      );
      const documents = store.documents.filter(
        (entry) => !(sameWorkspace(entry.workspacePath, workspacePath) && sameDocument(entry.documentRelativePath, documentRelativePath))
      );

      documents.push({
        workspacePath,
        documentRelativePath,
        ignoredIssueFingerprints,
        updatedAt: new Date().toISOString()
      });

      const nextStore: StoredWritingCorrectorMemory = {
        version: 1 as const,
        documents: documents.slice(-MAX_DOCUMENTS),
        dictionary: store.dictionary
      };
      await this.writeStore(nextStore);

      return this.snapshotFromStore(nextStore, workspacePath, documentRelativePath, language);
    });
  }

  async addDictionaryWord(language: WritingCorrectorLanguage, word: unknown): Promise<string[]> {
    return this.enqueue(async () => {
      const sanitizedWord = sanitizeWord(word);
      const store = await this.readStore();

      if (!sanitizedWord) {
        return this.customWordsFromStore(store, language);
      }

      const key = `${language}:${sanitizedWord}`;
      const dictionaryKey = new Set(store.dictionary.map((entry) => `${entry.language}:${entry.word}`));

      if (!dictionaryKey.has(key)) {
        store.dictionary.push({
          language,
          word: sanitizedWord,
          createdAt: new Date().toISOString()
        });
        store.dictionary = store.dictionary.slice(-MAX_DICTIONARY_WORDS);
        await this.writeStore(store);
      }

      return this.customWordsFromStore(store, language);
    });
  }

  private snapshotFromStore(
    store: StoredWritingCorrectorMemory,
    workspacePath: string,
    documentRelativePath: string,
    language: WritingCorrectorLanguage
  ): WritingCorrectorMemorySnapshot {
    const document = store.documents.find(
      (entry) => sameWorkspace(entry.workspacePath, workspacePath) && sameDocument(entry.documentRelativePath, documentRelativePath)
    );

    return {
      ignoredIssueFingerprints: document?.ignoredIssueFingerprints.slice() ?? [],
      customWords: this.customWordsFromStore(store, language)
    };
  }

  private customWordsFromStore(store: StoredWritingCorrectorMemory, language: WritingCorrectorLanguage) {
    return uniqueStrings(
      store.dictionary
        .filter((entry) => entry.language === language)
        .map((entry) => entry.word),
      MAX_DICTIONARY_WORDS
    );
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async readStore(): Promise<StoredWritingCorrectorMemory> {
    try {
      return sanitizeStore(JSON.parse(await readFile(this.storePath, "utf8")) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
        return emptyStore();
      }

      throw error;
    }
  }

  private async writeStore(store: StoredWritingCorrectorMemory) {
    await mkdir(path.dirname(this.storePath), { recursive: true });
    const tempPath = `${this.storePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await rename(tempPath, this.storePath);
  }
}
