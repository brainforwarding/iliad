export type WritingIssueSeverity = "info" | "warning" | "error";
export type WritingIssueCategory = "spelling" | "grammar" | "style";
export type WritingIssueSource = "harper" | "languagetool" | "vale" | "textlint" | "cspell";

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
