import { describe, expect, it } from "vitest";
import { appStrings } from "../../src/i18n/strings";

describe("writing assist copy", () => {
  it("labels pending review strip actions in both languages", () => {
    expect(appStrings.en.sidebar.pendingReviewSummary(2)).toBe("2 pending review items");
    expect(appStrings.en.sidebar.acceptPendingChanges).toBe("Accept all");
    expect(appStrings.en.sidebar.rejectPendingChanges).toBe("Reject all");
    expect(appStrings.es.sidebar.pendingReviewSummary(2)).toBe("2 cambios pendientes de revisión");
    expect(appStrings.es.sidebar.acceptPendingChanges).toBe("Aceptar todo");
    expect(appStrings.es.sidebar.rejectPendingChanges).toBe("Rechazar todo");
  });
});
