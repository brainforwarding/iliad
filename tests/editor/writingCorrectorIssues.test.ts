import { describe, expect, it } from "vitest";
import { type WritingIssue, writingIssueFingerprint, writingIssueKey } from "../../src/editor/writingCorrector/issues";

function issue(overrides: Partial<WritingIssue> = {}): WritingIssue {
  return {
    id: "writing-issue-harper-spelling-12-18-clener",
    from: 12,
    to: 18,
    originalText: "clener",
    severity: "warning",
    category: "spelling",
    source: "harper",
    ruleId: "Harper:Spelling",
    message: "Possible spelling mistake.",
    suggestions: [{ label: "cleaner", replacement: "cleaner" }],
    canAddToDictionary: true,
    canIgnore: true,
    ...overrides
  };
}

describe("writing corrector issue identity", () => {
  it("builds a position-specific issue key", () => {
    expect(writingIssueKey(issue())).toBe("Harper:Spelling:12:18:clener");
  });

  it("builds an offset-independent fingerprint for persisted ignores", () => {
    expect(writingIssueFingerprint(issue({ from: 12, to: 18 }), "en")).toBe(
      writingIssueFingerprint(issue({ from: 42, to: 48 }), "en")
    );
  });
});
