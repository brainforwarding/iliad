import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reviewButtons } from "../../src/editor/aiReview/extension";
import { acceptReviewShortcutApplies, nextChunkFocusIndex } from "../../src/editor/aiReview/keyboard";

// Minimal DOM stand-in: the review buttons only need elements, datasets,
// text, children, and event listeners.
class FakeElement {
  className = "";
  textContent = "";
  type = "";
  dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  private listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(readonly tagName: string) {}

  append(...nodes: FakeElement[]) {
    this.children.push(...nodes);
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatch(type: string, init: Record<string, unknown> = {}) {
    const event = { type, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...init };
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
    return event;
  }
}

const originalDocument = (globalThis as { document?: unknown }).document;

beforeEach(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (tagName: string) => new FakeElement(tagName)
  };
});

afterEach(() => {
  (globalThis as { document?: unknown }).document = originalDocument;
});

function render(escapeRejects: boolean | undefined, labels = { acceptChange: "Keep", rejectChange: "Restore" }) {
  const onAccept = vi.fn();
  const onReject = vi.fn();
  const actions = reviewButtons("hunk-1", onAccept, onReject, { labels, escapeRejects }) as unknown as FakeElement;
  return { actions, onAccept, onReject };
}

describe("review chunk keyboard safety", () => {
  it("never restores an outside chunk on Escape", () => {
    const { actions, onReject, onAccept } = render(false);

    actions.dispatch("keydown", { key: "Escape" });

    expect(onReject).not.toHaveBeenCalled();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("keeps Escape as reject for the tighten review", () => {
    const { actions, onReject } = render(undefined, { acceptChange: "Accept", rejectChange: "Reject" });

    actions.dispatch("keydown", { key: "Escape" });

    expect(onReject).toHaveBeenCalledWith("hunk-1");
  });

  it("labels outside chunk buttons Keep / Restore and marks the Keep button for focus", () => {
    const { actions, onAccept, onReject } = render(false);
    const [keep, restore] = actions.children;

    expect(keep.textContent).toBe("Keep");
    expect(keep.dataset.reviewAction).toBe("accept");
    expect(restore.textContent).toBe("Restore");
    keep.dispatch("click");
    restore.dispatch("click");
    expect(onAccept).toHaveBeenCalledWith("hunk-1");
    expect(onReject).toHaveBeenCalledWith("hunk-1");
  });

  it("lets Tab accept only the tighten review, never an outside review", () => {
    expect(acceptReviewShortcutApplies({ tightenReviewActive: true, outsideReviewActive: false })).toBe(true);
    expect(acceptReviewShortcutApplies({ tightenReviewActive: false, outsideReviewActive: true })).toBe(false);
    expect(acceptReviewShortcutApplies({ tightenReviewActive: true, outsideReviewActive: true })).toBe(false);
  });

  it("moves focus to the chunk that took the acted chunk's place", () => {
    expect(nextChunkFocusIndex(0, 2)).toBe(0);
    expect(nextChunkFocusIndex(2, 2)).toBe(1);
    expect(nextChunkFocusIndex(1, 0)).toBeNull();
  });
});
