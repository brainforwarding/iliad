import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SIDEBAR_PEEK_HIDE_DELAY_MS, SidebarPeekController } from "../../src/app/useSidebarPeek";

function setup() {
  const changes: boolean[] = [];
  const peek = new SidebarPeekController({ onChange: (open) => changes.push(open) });
  peek.setEnabled(true);
  return { peek, changes };
}

describe("SidebarPeekController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("opens from the toggle or the edge, not from the sidebar or top row alone", () => {
    const { peek } = setup();
    peek.enter("topbar");
    peek.enter("sidebar");
    expect(peek.isOpen).toBe(false);
    peek.enter("edge");
    expect(peek.isOpen).toBe(true);
  });

  it("never opens while the sidebar is pinned, and closes when it becomes pinned", () => {
    const { peek } = setup();
    peek.setEnabled(false);
    peek.enter("toggle");
    expect(peek.isOpen).toBe(false);
    peek.leave("toggle");
    peek.setEnabled(true);
    peek.enter("toggle");
    expect(peek.isOpen).toBe(true);
    peek.setEnabled(false);
    expect(peek.isOpen).toBe(false);
  });

  it("hides one delay after the pointer leaves every region; moving between them keeps it", () => {
    const { peek, changes } = setup();
    peek.enter("toggle");
    peek.enter("topbar");
    peek.leave("toggle");
    vi.advanceTimersByTime(SIDEBAR_PEEK_HIDE_DELAY_MS * 2);
    expect(peek.isOpen).toBe(true);

    peek.leave("topbar");
    vi.advanceTimersByTime(SIDEBAR_PEEK_HIDE_DELAY_MS - 10);
    peek.enter("sidebar"); // back in time: the timer is cancelled
    vi.advanceTimersByTime(SIDEBAR_PEEK_HIDE_DELAY_MS * 2);
    expect(peek.isOpen).toBe(true);

    peek.leave("sidebar");
    vi.advanceTimersByTime(SIDEBAR_PEEK_HIDE_DELAY_MS);
    expect(peek.isOpen).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it("holds open during a context menu or rename, then hides once released", () => {
    const { peek } = setup();
    peek.enter("toggle");
    peek.setHold(true);
    peek.leave("toggle");
    vi.advanceTimersByTime(SIDEBAR_PEEK_HIDE_DELAY_MS * 4);
    expect(peek.isOpen).toBe(true);
    peek.setHold(false);
    vi.advanceTimersByTime(SIDEBAR_PEEK_HIDE_DELAY_MS);
    expect(peek.isOpen).toBe(false);
  });

  it("closes at once on close() (Escape), and forgets the unmounted sidebar", () => {
    const { peek } = setup();
    peek.enter("toggle");
    peek.enter("sidebar");
    peek.leave("toggle");
    peek.close();
    expect(peek.isOpen).toBe(false);

    // Reopened from the edge: no stale "sidebar" hover keeps it open.
    peek.enter("edge");
    peek.leave("edge");
    vi.advanceTimersByTime(SIDEBAR_PEEK_HIDE_DELAY_MS);
    expect(peek.isOpen).toBe(false);
  });
});
