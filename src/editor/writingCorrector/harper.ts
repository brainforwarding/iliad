import type { Lint, LintKind } from "harper.js";
import {
  blockedLineRangesToTextRanges,
  collectMarkdownExcludedRanges,
  mergeTextRanges,
  rangeIntersectsAny,
  wordRangeAt,
  type BlockedLineRange,
  type TextRange
} from "../writingAssistContext";
import {
  type WritingIssue,
  type WritingIssueCategory,
  type WritingIssueSuggestion,
  writingIssueFingerprint,
  writingIssueKey
} from "./issues";

export interface DetectWritingIssuesOptions {
  language: "en" | "es";
  cursor?: number | null;
  blockedLineRanges?: readonly BlockedLineRange[];
  ignoredIssueKeys?: ReadonlySet<string>;
  customWords?: ReadonlySet<string>;
}

type HarperLinter = import("harper.js").Linter;

const harperFailureLogKey = "iliad:writing-corrector-harper-failure-logged";
const harperSuggestionKind = {
  replace: 0,
  remove: 1
} as const;

let linterPromise: Promise<HarperLinter> | null = null;
let syncedCustomWordsKey = "";

function buildIssueId(input: Pick<WritingIssue, "source" | "ruleId" | "originalText" | "from" | "to">) {
  const key = `${input.source}:${input.ruleId}:${input.from}:${input.to}:${input.originalText.toLowerCase()}`;
  return `writing-issue-${key.replace(/[^a-z0-9_-]+/gi, "-")}`;
}

function normalizeCustomWords(words: ReadonlySet<string> | undefined) {
  return Array.from(words ?? [])
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean)
    .sort();
}

async function syncCustomWords(linter: HarperLinter, words: ReadonlySet<string> | undefined) {
  const normalizedWords = normalizeCustomWords(words);
  const nextKey = normalizedWords.join("\n");

  if (nextKey === syncedCustomWordsKey) {
    return;
  }

  await linter.clearWords();

  if (normalizedWords.length > 0) {
    await linter.importWords(normalizedWords);
  }

  syncedCustomWordsKey = nextKey;
}

async function createHarperLinter() {
  const [{ LocalLinter, WorkerLinter }, { binary }] = await Promise.all([
    import("harper.js"),
    import("harper.js/binary")
  ]);
  const LinterConstructor = typeof Worker === "undefined" ? LocalLinter : WorkerLinter;
  const linter = new LinterConstructor({ binary });

  await linter.setup();
  return linter;
}

async function getHarperLinter() {
  if (!linterPromise) {
    linterPromise = createHarperLinter().catch((error) => {
      linterPromise = null;
      syncedCustomWordsKey = "";
      throw error;
    });
  }

  return linterPromise;
}

export function scalarOffsetToCodeUnitOffset(text: string, scalarOffset: number) {
  const target = Math.max(0, Math.floor(scalarOffset));
  let scalarIndex = 0;
  let codeUnitOffset = 0;

  for (const scalar of text) {
    if (scalarIndex >= target) {
      break;
    }

    codeUnitOffset += scalar.length;
    scalarIndex += 1;
  }

  return codeUnitOffset;
}

export function harperSpanToTextRange(text: string, span: { start: number; end: number }): TextRange {
  const from = scalarOffsetToCodeUnitOffset(text, span.start);
  const to = scalarOffsetToCodeUnitOffset(text, span.end);

  return { from, to };
}

function categoryForLintKind(kind: string): WritingIssueCategory {
  const spellingKinds = new Set<string>(["Spelling", "Typo"]);
  const styleKinds = new Set<string>(["Enhancement", "Readability", "Redundancy", "Style", "WordChoice"]);

  if (spellingKinds.has(kind)) {
    return "spelling";
  }

  if (styleKinds.has(kind)) {
    return "style";
  }

  return "grammar";
}

function suggestionsForLint(lint: Lint): WritingIssueSuggestion[] {
  return lint
    .suggestions()
    .filter(
      (suggestion) =>
        suggestion.kind() === harperSuggestionKind.replace || suggestion.kind() === harperSuggestionKind.remove
    )
    .map((suggestion) => {
      const replacement = suggestion.get_replacement_text();

      return {
        label: replacement || "Remove",
        replacement
      };
    })
    .filter((suggestion, index, suggestions) =>
      suggestions.findIndex((candidate) => candidate.replacement === suggestion.replacement) === index
    )
    .slice(0, 5);
}

function isSuppressed(
  issue: WritingIssue,
  context: {
    excludedRanges: readonly TextRange[];
    blockedRanges: readonly TextRange[];
    currentWordRange: TextRange | null;
    ignoredIssueKeys: ReadonlySet<string>;
    language: "en" | "es";
  }
) {
  const range = { from: issue.from, to: issue.to };

  if (
    rangeIntersectsAny(range, context.excludedRanges) ||
    rangeIntersectsAny(range, context.blockedRanges) ||
    Boolean(context.currentWordRange && rangeIntersectsAny(range, [context.currentWordRange]))
  ) {
    return true;
  }

  return (
    context.ignoredIssueKeys.has(writingIssueKey(issue)) ||
    context.ignoredIssueKeys.has(writingIssueFingerprint(issue, context.language))
  );
}

export function harperLintToWritingIssue(text: string, lint: Lint): WritingIssue | null {
  const span = lint.span();
  const { from, to } = harperSpanToTextRange(text, span);

  if (to <= from) {
    return null;
  }

  const originalText = text.slice(from, to);
  const kind = lint.lint_kind() as LintKind;
  const category = categoryForLintKind(kind);
  const ruleId = `Harper:${kind}`;
  const issue: WritingIssue = {
    id: buildIssueId({ source: "harper", ruleId, originalText, from, to }),
    from,
    to,
    originalText,
    severity: "warning",
    category,
    source: "harper",
    ruleId,
    message: lint.message(),
    suggestions: suggestionsForLint(lint),
    canAddToDictionary: category === "spelling",
    canIgnore: true
  };

  return issue;
}

export function filterWritingIssues(
  text: string,
  issues: readonly WritingIssue[],
  options: DetectWritingIssuesOptions
) {
  const excludedRanges = collectMarkdownExcludedRanges(text);
  const blockedRanges = mergeTextRanges(blockedLineRangesToTextRanges(text, options.blockedLineRanges));
  const currentWordRange = typeof options.cursor === "number" ? wordRangeAt(text, options.cursor) : null;
  const ignoredIssueKeys = options.ignoredIssueKeys ?? new Set<string>();

  return issues
    .filter(
      (issue) =>
        !isSuppressed(issue, {
          excludedRanges,
          blockedRanges,
          currentWordRange,
          ignoredIssueKeys,
          language: options.language
        })
    )
    .sort((left, right) => (left.from === right.from ? left.to - right.to : left.from - right.from));
}

export async function detectWritingIssues(text: string, options: DetectWritingIssuesOptions): Promise<WritingIssue[]> {
  if (options.language !== "en" || !text.trim()) {
    return [];
  }

  try {
    const linter = await getHarperLinter();
    await syncCustomWords(linter, options.customWords);
    const lints = await linter.lint(text, { language: "markdown" });
    const issues = lints
      .map((lint) => harperLintToWritingIssue(text, lint))
      .filter((issue): issue is WritingIssue => Boolean(issue));

    return filterWritingIssues(text, issues, options);
  } catch (error) {
    if (typeof window !== "undefined" && !window.sessionStorage.getItem(harperFailureLogKey)) {
      window.sessionStorage.setItem(harperFailureLogKey, "true");
      console.warn("Harper writing corrector unavailable; no writing issues will be shown.", error);
    }

    return [];
  }
}
