import { describe, expect, it } from "vitest";
import {
  detectLocalWritingIssues,
  writingIssueFingerprint,
  writingIssueKey
} from "../../src/editor/writingCorrector/issues";

describe("local writing corrector issues", () => {
  it("detects repeated words and common misspellings in English prose", () => {
    const doc = "This is teh the the adoument and i dont know if its working.";
    const issues = detectLocalWritingIssues(doc, { language: "en", cursor: null });

    expect(issues.map((issue) => issue.ruleId)).toEqual([
      "CommonMisspelling",
      "RepeatedWord",
      "CommonMisspelling",
      "LowercasePronounI",
      "CommonMisspelling",
      "ItsContraction"
    ]);
    expect(issues[0]).toMatchObject({
      originalText: "teh",
      suggestions: [{ label: "the", replacement: "the" }]
    });
    expect(issues[1]).toMatchObject({
      originalText: " the",
      suggestions: [{ replacement: "" }]
    });
    expect(issues[2]).toMatchObject({
      originalText: "adoument",
      suggestions: [{ label: "document", replacement: "document" }]
    });
    expect(issues[3]).toMatchObject({
      originalText: "i",
      suggestions: [{ label: "I", replacement: "I" }]
    });
    expect(issues[4]).toMatchObject({
      originalText: "dont",
      suggestions: [{ label: "don't", replacement: "don't" }]
    });
    expect(issues[5]).toMatchObject({
      originalText: "its",
      suggestions: [{ label: "it's", replacement: "it's" }]
    });
  });

  it("skips Markdown syntax regions, the current word, ignored issues, and custom words", () => {
    const doc = ["This teh should show.", "`teh code` should not.", "Current recieve"].join("\n");
    const currentWordCursor = doc.length;
    const initialIssues = detectLocalWritingIssues(doc, {
      language: "en",
      cursor: currentWordCursor,
      customWords: new Set(["teh"])
    });

    expect(initialIssues).toHaveLength(0);

    const withoutDictionary = detectLocalWritingIssues(doc, {
      language: "en",
      cursor: currentWordCursor
    });
    const ignoredKey = writingIssueKey(withoutDictionary[0]);
    const ignored = detectLocalWritingIssues(doc, {
      language: "en",
      cursor: currentWordCursor,
      ignoredIssueKeys: new Set([ignoredKey])
    });

    expect(withoutDictionary).toHaveLength(1);
    expect(ignored).toHaveLength(0);
  });

  it("suppresses issues by stable fingerprint without relying on offsets", () => {
    const firstDoc = "Hey im writing.";
    const firstIssue = detectLocalWritingIssues(firstDoc, { language: "en", cursor: null })[0];
    expect(firstIssue).toBeDefined();
    const fingerprint = writingIssueFingerprint(firstIssue!, "en");
    const movedDoc = "A new opening sentence. Hey im writing.";

    const issues = detectLocalWritingIssues(movedDoc, {
      language: "en",
      cursor: null,
      ignoredIssueKeys: new Set([fingerprint])
    });

    expect(issues.find((issue) => issue.ruleId === "CommonMisspelling" && issue.originalText === "im")).toBeUndefined();
  });

  it("returns no local issues for Spanish documents in phase one", () => {
    expect(detectLocalWritingIssues("Este texto tiene teh.", { language: "es", cursor: null })).toEqual([]);
  });
});
