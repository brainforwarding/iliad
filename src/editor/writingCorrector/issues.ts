import {
  blockedLineRangesToTextRanges,
  collectMarkdownExcludedRanges,
  mergeTextRanges,
  rangeIntersectsAny,
  wordRangeAt,
  type BlockedLineRange,
  type TextRange
} from "../writingAssistContext";

export type WritingIssueSeverity = "info" | "warning" | "error";
export type WritingIssueCategory = "spelling" | "grammar" | "style";
export type WritingIssueSource = "local" | "harper" | "languagetool" | "vale" | "textlint" | "cspell";

export interface WritingIssueSuggestion {
  label: string;
  replacement: string;
}

export interface WritingIssue {
  id: string;
  from: number;
  to: number;
  originalText: string;
  severity: WritingIssueSeverity;
  category: WritingIssueCategory;
  source: WritingIssueSource;
  ruleId: string;
  message: string;
  suggestions: WritingIssueSuggestion[];
  canAddToDictionary?: boolean;
  canIgnore?: boolean;
}

interface DetectLocalWritingIssuesOptions {
  language: "en" | "es";
  cursor?: number | null;
  blockedLineRanges?: readonly BlockedLineRange[];
  ignoredIssueKeys?: ReadonlySet<string>;
  customWords?: ReadonlySet<string>;
}

const commonMisspellings: Record<string, string> = {
  accomodate: "accommodate",
  adress: "address",
  adoument: "document",
  alot: "a lot",
  arent: "aren't",
  becuase: "because",
  cant: "can't",
  couldnt: "couldn't",
  definately: "definitely",
  didnt: "didn't",
  doesnt: "doesn't",
  dont: "don't",
  id: "I'd",
  ill: "I'll",
  im: "I'm",
  isnt: "isn't",
  ive: "I've",
  seperate: "separate",
  shouldnt: "shouldn't",
  teh: "the",
  theyre: "they're",
  recieve: "receive",
  recieved: "received",
  wasnt: "wasn't",
  werent: "weren't",
  wierd: "weird",
  wont: "won't",
  wouldnt: "wouldn't",
  youre: "you're"
};

function capitalizeLike(original: string, replacement: string) {
  if (original.toUpperCase() === original) {
    return replacement.toUpperCase();
  }

  if (original[0]?.toUpperCase() === original[0]) {
    return `${replacement[0]?.toUpperCase() ?? ""}${replacement.slice(1)}`;
  }

  return replacement;
}

function issueKey(input: Pick<WritingIssue, "ruleId" | "originalText" | "from" | "to">) {
  return `${input.ruleId}:${input.from}:${input.to}:${input.originalText.toLowerCase()}`;
}

export function writingIssueKey(issue: WritingIssue) {
  return issueKey(issue);
}

function normalizeFingerprintPart(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function writingIssueFingerprint(issue: WritingIssue, language: "en" | "es" = "en") {
  const replacements = issue.suggestions
    .map((suggestion) => normalizeFingerprintPart(suggestion.replacement))
    .sort()
    .join("|");

  return [
    "writing-issue",
    "v1",
    language,
    issue.source,
    issue.ruleId,
    issue.category,
    normalizeFingerprintPart(issue.originalText),
    replacements
  ].join("\u001f");
}

function issueId(input: Pick<WritingIssue, "ruleId" | "originalText" | "from" | "to">) {
  return `writing-issue-${issueKey(input).replace(/[^a-z0-9_-]+/gi, "-")}`;
}

function isSuppressed(
  range: TextRange,
  text: string,
  excludedRanges: readonly TextRange[],
  blockedRanges: readonly TextRange[],
  currentWordRange: TextRange | null
) {
  if (rangeIntersectsAny(range, excludedRanges) || rangeIntersectsAny(range, blockedRanges)) {
    return true;
  }

  return Boolean(currentWordRange && rangeIntersectsAny(range, [currentWordRange]));
}

function maybePushIssue(
  issues: WritingIssue[],
  issue: WritingIssue,
  ignoredIssueKeys: ReadonlySet<string>,
  language: "en" | "es"
) {
  if (!ignoredIssueKeys.has(writingIssueKey(issue)) && !ignoredIssueKeys.has(writingIssueFingerprint(issue, language))) {
    issues.push(issue);
  }
}

function detectRepeatedWords(
  text: string,
  issues: WritingIssue[],
  context: {
    excludedRanges: readonly TextRange[];
    blockedRanges: readonly TextRange[];
    currentWordRange: TextRange | null;
    ignoredIssueKeys: ReadonlySet<string>;
    language: "en" | "es";
  }
) {
  const repeatedWordPattern = /\b([\p{L}][\p{L}'-]*)\b(\s+)\b\1\b/giu;
  let match: RegExpExecArray | null;

  while ((match = repeatedWordPattern.exec(text))) {
    const repeatedWord = match[1];
    const from = match.index + match[1].length;
    const to = match.index + match[0].length;

    if (isSuppressed({ from, to }, text, context.excludedRanges, context.blockedRanges, context.currentWordRange)) {
      continue;
    }

    maybePushIssue(
      issues,
      {
        id: issueId({ ruleId: "RepeatedWord", originalText: text.slice(from, to), from, to }),
        from,
        to,
        originalText: text.slice(from, to),
        severity: "warning",
        category: "grammar",
        source: "local",
        ruleId: "RepeatedWord",
        message: `Repeated word: "${repeatedWord}".`,
        suggestions: [{ label: `Remove "${repeatedWord}"`, replacement: "" }],
        canIgnore: true
      },
      context.ignoredIssueKeys,
      context.language
    );
  }
}

function detectCommonMisspellings(
  text: string,
  issues: WritingIssue[],
  context: {
    excludedRanges: readonly TextRange[];
    blockedRanges: readonly TextRange[];
    currentWordRange: TextRange | null;
    ignoredIssueKeys: ReadonlySet<string>;
    customWords: ReadonlySet<string>;
    language: "en" | "es";
  }
) {
  const wordPattern = /\b[\p{L}][\p{L}'-]*\b/giu;
  let match: RegExpExecArray | null;

  while ((match = wordPattern.exec(text))) {
    const originalText = match[0];
    const normalized = originalText.toLowerCase();
    const replacement = commonMisspellings[normalized];

    if (!replacement || context.customWords.has(normalized)) {
      continue;
    }

    const from = match.index;
    const to = from + originalText.length;

    if (isSuppressed({ from, to }, text, context.excludedRanges, context.blockedRanges, context.currentWordRange)) {
      continue;
    }

    const corrected = capitalizeLike(originalText, replacement);

    maybePushIssue(
      issues,
      {
        id: issueId({ ruleId: "CommonMisspelling", originalText, from, to }),
        from,
        to,
        originalText,
        severity: "warning",
        category: "spelling",
        source: "local",
        ruleId: "CommonMisspelling",
        message: `Possible misspelling: "${originalText}".`,
        suggestions: [{ label: corrected, replacement: corrected }],
        canAddToDictionary: true,
        canIgnore: true
      },
      context.ignoredIssueKeys,
      context.language
    );
  }
}

function detectLowercasePronounI(
  text: string,
  issues: WritingIssue[],
  context: {
    excludedRanges: readonly TextRange[];
    blockedRanges: readonly TextRange[];
    currentWordRange: TextRange | null;
    ignoredIssueKeys: ReadonlySet<string>;
    language: "en" | "es";
  }
) {
  const pronounPattern = /\bi\b/gu;
  let match: RegExpExecArray | null;

  while ((match = pronounPattern.exec(text))) {
    const from = match.index;
    const to = from + 1;

    if (isSuppressed({ from, to }, text, context.excludedRanges, context.blockedRanges, context.currentWordRange)) {
      continue;
    }

    maybePushIssue(
      issues,
      {
        id: issueId({ ruleId: "LowercasePronounI", originalText: "i", from, to }),
        from,
        to,
        originalText: "i",
        severity: "warning",
        category: "grammar",
        source: "local",
        ruleId: "LowercasePronounI",
        message: 'Capitalize the pronoun "I".',
        suggestions: [{ label: "I", replacement: "I" }],
        canIgnore: true
      },
      context.ignoredIssueKeys,
      context.language
    );
  }
}

function detectItsContraction(
  text: string,
  issues: WritingIssue[],
  context: {
    excludedRanges: readonly TextRange[];
    blockedRanges: readonly TextRange[];
    currentWordRange: TextRange | null;
    ignoredIssueKeys: ReadonlySet<string>;
    language: "en" | "es";
  }
) {
  const itsPattern = /\bits\b(?=\s+(?:not\b|going\b|[a-z]+ing\b))/giu;
  let match: RegExpExecArray | null;

  while ((match = itsPattern.exec(text))) {
    const originalText = match[0];
    const from = match.index;
    const to = from + originalText.length;

    if (isSuppressed({ from, to }, text, context.excludedRanges, context.blockedRanges, context.currentWordRange)) {
      continue;
    }

    const replacement = capitalizeLike(originalText, "it's");

    maybePushIssue(
      issues,
      {
        id: issueId({ ruleId: "ItsContraction", originalText, from, to }),
        from,
        to,
        originalText,
        severity: "warning",
        category: "grammar",
        source: "local",
        ruleId: "ItsContraction",
        message: 'Use "it\'s" for "it is".',
        suggestions: [{ label: replacement, replacement }],
        canIgnore: true
      },
      context.ignoredIssueKeys,
      context.language
    );
  }
}

export function detectLocalWritingIssues(text: string, options: DetectLocalWritingIssuesOptions): WritingIssue[] {
  if (options.language !== "en") {
    return [];
  }

  const excludedRanges = collectMarkdownExcludedRanges(text);
  const blockedRanges = mergeTextRanges(blockedLineRangesToTextRanges(text, options.blockedLineRanges));
  const currentWordRange = typeof options.cursor === "number" ? wordRangeAt(text, options.cursor) : null;
  const ignoredIssueKeys = options.ignoredIssueKeys ?? new Set<string>();
  const customWords = options.customWords ?? new Set<string>();
  const issues: WritingIssue[] = [];
  const context = {
    excludedRanges,
    blockedRanges,
    currentWordRange,
    ignoredIssueKeys,
    customWords,
    language: options.language
  };

  detectRepeatedWords(text, issues, context);
  detectCommonMisspellings(text, issues, context);
  detectLowercasePronounI(text, issues, context);
  detectItsContraction(text, issues, context);

  return issues.sort((left, right) => (left.from === right.from ? left.to - right.to : left.from - right.from));
}
