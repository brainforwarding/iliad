import { describe, expect, it } from "vitest";
import { appStrings } from "../../src/i18n/strings";

describe("writing assist copy", () => {
  it("labels pending review strip actions in both languages", () => {
    expect(appStrings.en.sidebar.pendingReviewSummary(2)).toBe("2 changed");
    expect(appStrings.en.sidebar.acceptPendingChanges).toBe("Keep all");
    expect(appStrings.en.sidebar.rejectPendingChanges).toBe("Restore all");
    expect(appStrings.es.sidebar.pendingReviewSummary(2)).toBe("2 con cambios");
    expect(appStrings.es.sidebar.acceptPendingChanges).toBe("Conservar todo");
    expect(appStrings.es.sidebar.rejectPendingChanges).toBe("Restaurar todo");
  });
});
