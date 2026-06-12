import { describe, expect, it } from "vitest";
import { documentCloseRequiresChoice, type SaveStatus } from "../../src/app/useDocumentPersistence";

describe("documentCloseRequiresChoice", () => {
  it("prompts only for unsaved or errored documents", () => {
    const statuses: Record<SaveStatus, boolean> = {
      saved: false,
      saving: false,
      unsaved: true,
      error: true
    };

    for (const [status, expected] of Object.entries(statuses) as Array<[SaveStatus, boolean]>) {
      expect(documentCloseRequiresChoice(status)).toBe(expected);
    }
  });
});
