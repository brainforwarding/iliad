import { describe, expect, it } from "vitest";
import {
  forgetNamingAttempts,
  maxNamingAttempts,
  namingAttemptAllowed,
  namingConditionsMet,
  namingFailureDropsCandidate,
  type NamingConditions
} from "../../src/app/useDocumentNaming";
import { documentNamingApi } from "../../src/app/documentNamingApi";

const ready: NamingConditions = {
  isCandidate: true,
  editorShowsActiveFile: true,
  saveStatus: "saved",
  underReview: false,
  renaming: false,
  windowFocused: true
};

describe("naming trigger conditions", () => {
  it("names only a saved, focused candidate with no review or rename in progress", () => {
    expect(namingConditionsMet(ready)).toBe(true);
    expect(namingConditionsMet({ ...ready, isCandidate: false })).toBe(false);
    expect(namingConditionsMet({ ...ready, editorShowsActiveFile: false })).toBe(false);
    expect(namingConditionsMet({ ...ready, underReview: true })).toBe(false);
    expect(namingConditionsMet({ ...ready, renaming: true })).toBe(false);
    expect(namingConditionsMet({ ...ready, windowFocused: false })).toBe(false);

    for (const saveStatus of ["unsaved", "saving", "error", "conflict"] as const) {
      expect(namingConditionsMet({ ...ready, saveStatus })).toBe(false);
    }
  });

  it("allows at most two dispatched attempts per candidate", () => {
    expect(maxNamingAttempts).toBe(2);
    expect(namingAttemptAllowed(0)).toBe(true);
    expect(namingAttemptAllowed(1)).toBe(true);
    expect(namingAttemptAllowed(2)).toBe(false);
  });

  it("gives a new document at a reused path a fresh budget (⌘N makes untitled.md again after naming)", () => {
    const attempts = new Map([
      ["/ws\u0000untitled.md", 2],
      ["/ws\u0000untitled-2.md", 1],
      ["/other\u0000untitled.md", 2]
    ]);
    // untitled.md was named (no longer a candidate); untitled-2.md still is.
    forgetNamingAttempts(attempts, "/ws", ["untitled-2.md"]);
    expect([...attempts.entries()]).toEqual([
      ["/ws\u0000untitled-2.md", 1],
      ["/other\u0000untitled.md", 2]
    ]);
  });

  it("stops naming a document that changed outside Iliad or came under review", () => {
    expect(namingFailureDropsCandidate("changed")).toBe(true);
    expect(namingFailureDropsCandidate("under_review")).toBe(true);
    expect(namingFailureDropsCandidate("collision")).toBe(false);
    expect(namingFailureDropsCandidate("failed")).toBe(false);
  });

  it("tolerates a preload without the naming bridge", () => {
    expect(documentNamingApi()).toBeNull();
  });
});
