import { isCompanionPath } from "./companionFiles";
import type { FileTreeNode } from "../types/iliad";

/**
 * Pure helpers for naming untitled documents (spec
 * `specs/2026-09-27-name-untitled-documents.md`): the heading name, the
 * folder's naming style, the file-name formatter and the "enough text" rule.
 * They never touch the file system; the guarded rename lives in main.
 */

export type FolderNamingStyle = "kebab" | "spaced";

/** Longest stem the formatter produces (cut at a word boundary when possible). */
export const maxDocumentStemLength = 60;
/** Characters of prose (excluding the heading) that make a document "long enough" to name. */
export const minNamingProseLength = 200;
/** The opening text sent to the AI for a title. */
export const maxNamingInputLength = 1500;

const fencePattern = /^ {0,3}(`{3,}|~{3,})/;
const atxHeadingPattern = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const markdownExtension = /\.(md|markdown|mdown|mkd)$/i;
const kebabStemPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// C0/C1 controls, plus zero-width and bidi format characters that would make
// a file name look different from what it is.
// eslint-disable-next-line no-control-regex
const invisiblePattern = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

function lines(text: string) {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

/** Strips simple inline Markdown: images/links → their text, code, emphasis, strike. */
export function stripInlineMarkdown(text: string) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1")
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/\\([\\`*_{}[\]()#+\-.!~|])/g, "$1");
}

/** True when the text has at least one letter or digit (not only emoji/symbols). */
function hasWordCharacter(text: string) {
  return /[\p{L}\p{N}]/u.test(text);
}

interface FirstLine {
  index: number;
  line: string;
}

function firstNonEmptyLine(allLines: string[]): FirstLine | null {
  for (let index = 0; index < allLines.length; index += 1) {
    if (allLines[index].trim()) {
      return { index, line: allLines[index] };
    }
  }

  return null;
}

function headingText(line: string) {
  if (fencePattern.test(line)) {
    return null;
  }

  const match = atxHeadingPattern.exec(line);

  if (!match) {
    return null;
  }

  // Closing sequence: spaces then only #s ("# Hola #" → "Hola").
  return (match[2] ?? "").replace(/(?:^|[ \t]+)#+$/, "").trim();
}

/**
 * The name the writer gave the document with a heading: the first non-empty
 * line must be an ATX heading (so never inside a fence). Closing #s and
 * simple inline Markdown are stripped. Empty or emoji/symbol-only → null (the
 * AI names it instead).
 */
export function headingDocumentName(text: string): string | null {
  const first = firstNonEmptyLine(lines(text));

  if (!first) {
    return null;
  }

  const heading = headingText(first.line);

  if (heading === null) {
    return null;
  }

  const name = stripInlineMarkdown(heading).replace(/\s+/g, " ").trim();

  return name && hasWordCharacter(name) ? name : null;
}

/**
 * Enough text to name the document: a first-line heading the writer finished
 * (a line break follows it), or at least ~200 characters of prose besides
 * that heading.
 */
export function hasEnoughTextToName(text: string) {
  const allLines = lines(text);
  const first = firstNonEmptyLine(allLines);

  if (!first) {
    return false;
  }

  const heading = headingText(first.line);

  if (heading !== null && headingDocumentName(text) && first.index < allLines.length - 1) {
    return true;
  }

  const prose = allLines
    .filter((_, index) => !(heading !== null && index === first.index))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return [...prose].length >= minNamingProseLength;
}

/** The opening text sent to the AI (whole code points, at most ~1,500). */
export function namingInputText(text: string) {
  const characters = [...text];

  return characters.length <= maxNamingInputLength ? text : characters.slice(0, maxNamingInputLength).join("");
}

function stemOf(name: string) {
  return name.replace(markdownExtension, "");
}

/** The Markdown documents in the same folder, excluding the document itself and companions. */
export function siblingDocumentNames(tree: FileTreeNode[], workspaceRoot: string, documentPath: string) {
  const normalizedPath = documentPath.replace(/\\/g, "/");
  const slash = normalizedPath.lastIndexOf("/");
  const parentPath = slash > 0 ? normalizedPath.slice(0, slash) : normalizedPath;
  const normalizedRoot = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  let children: FileTreeNode[] | undefined = tree;

  if (parentPath !== normalizedRoot) {
    const findDirectory = (nodes: FileTreeNode[]): FileTreeNode | null => {
      for (const node of nodes) {
        if (node.kind === "directory" && node.path.replace(/\\/g, "/") === parentPath) {
          return node;
        }

        const found = node.children ? findDirectory(node.children) : null;

        if (found) {
          return found;
        }
      }

      return null;
    };
    children = findDirectory(tree)?.children;
  }

  return (children ?? [])
    .filter(
      (node) =>
        node.kind === "markdown" &&
        node.path.replace(/\\/g, "/") !== normalizedPath &&
        !isCompanionPath(node.name) &&
        !node.companion
    )
    .map((node) => node.name);
}

/**
 * The folder's style from sibling document names: kebab stems match
 * `^[a-z0-9]+(-[a-z0-9]+)*$`, spaced stems contain a space. Spaced wins only
 * with strictly more files than kebab; otherwise (a tie, no clear signal, no
 * siblings) kebab.
 */
export function detectFolderNamingStyle(siblingNames: string[]): FolderNamingStyle {
  let kebab = 0;
  let spaced = 0;

  for (const name of siblingNames) {
    if (isCompanionPath(name) || !markdownExtension.test(name)) {
      continue;
    }

    const stem = stemOf(name);

    if (kebabStemPattern.test(stem)) {
      kebab += 1;
    } else if (stem.includes(" ")) {
      spaced += 1;
    }
  }

  return spaced > kebab ? "spaced" : "kebab";
}

function cutAtBoundary(stem: string, separator: string) {
  const characters = [...stem];

  if (characters.length <= maxDocumentStemLength) {
    return stem;
  }

  const head = characters.slice(0, maxDocumentStemLength + 1).join("");
  const boundary = head.lastIndexOf(separator);

  // A boundary too close to the start would throw most of the title away;
  // a long unbroken word is cut at the limit instead.
  if (boundary >= maxDocumentStemLength / 3) {
    return head.slice(0, boundary);
  }

  return characters.slice(0, maxDocumentStemLength).join("");
}

function trimSeparators(stem: string, separator: string) {
  const escaped = separator === " " ? " " : "\\-";
  return stem.replace(new RegExp(`^[${escaped}]+|[${escaped}]+$`, "g"), "");
}

/**
 * Formats a title (from a heading or the AI) as a file stem in the folder's
 * style; null when nothing usable is left. Kebab: accents stripped,
 * lowercase, `[a-z0-9]+` joined by "-". Spaced: letters (with accents),
 * digits and single spaces, capitals kept. Both are at most 60 characters and
 * always valid for main's Markdown rename rules (no separators, no dots).
 */
export function formatDocumentStem(title: string, style: FolderNamingStyle): string | null {
  const clean = title.normalize("NFC").replace(invisiblePattern, " ").replace(/\s+/g, " ").trim();

  if (!clean) {
    return null;
  }

  let stem: string;

  if (style === "kebab") {
    const words = clean
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .match(/[a-z0-9]+/g);

    stem = words ? trimSeparators(cutAtBoundary(words.join("-"), "-"), "-") : "";
  } else {
    const spaced = clean
      .replace(/[^\p{L}\p{M}\p{N} ]+/gu, " ")
      .replace(/ +/g, " ")
      .trim()
      .normalize("NFC");

    stem = trimSeparators(cutAtBoundary(spaced, " "), " ");
  }

  if (!stem || stem.startsWith(".") || !hasWordCharacter(stem)) {
    return null;
  }

  return stem;
}

/** The stem of a document path or name (`dir/untitled-2.md` → `untitled-2`). */
export function documentStem(pathOrName: string) {
  const name = pathOrName.replace(/\\/g, "/").split("/").pop() ?? pathOrName;
  return stemOf(name);
}

/**
 * The file name a rename field's value asks for: Markdown documents are typed
 * without an extension and saved as `.md`; other files keep what was typed.
 */
export function fileNameFromRenameInput(node: Pick<FileTreeNode, "kind">, value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return "";
  }

  return node.kind === "markdown" ? `${stemOf(trimmedValue)}.md` : trimmedValue;
}

export type DocumentNamePlan =
  | { source: "heading"; title: string }
  | { source: "ai"; text: string };

/** Where the name comes from: the writer's heading (no AI) or the AI from the opening text. */
export function planDocumentName(text: string): DocumentNamePlan | null {
  if (!hasEnoughTextToName(text)) {
    return null;
  }

  const heading = headingDocumentName(text);

  return heading ? { source: "heading", title: heading } : { source: "ai", text: namingInputText(text) };
}
