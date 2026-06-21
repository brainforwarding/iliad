import { describe, expect, it } from "vitest";
import { appStrings } from "../../src/i18n/strings";

describe("writing assist copy", () => {
  it("labels pending review strip actions in both languages", () => {
    expect(appStrings.en.sidebar.pendingReviewSummary(2)).toBe("2 pending review items");
    expect(appStrings.en.sidebar.reviewPendingChanges).toBe("Review");
    expect(appStrings.en.sidebar.discardPendingChanges).toBe("Restore all...");
    expect(appStrings.es.sidebar.pendingReviewSummary(2)).toBe("2 cambios pendientes de revisión");
    expect(appStrings.es.sidebar.reviewPendingChanges).toBe("Revisar");
    expect(appStrings.es.sidebar.discardPendingChanges).toBe("Restaurar todo...");
  });
});
