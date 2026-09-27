import { useCallback, useEffect, useMemo, useState } from "react";

/** Where the pointer can be while the peek sidebar is involved. */
export type SidebarPeekRegion = "toggle" | "edge" | "sidebar" | "topbar";

export const SIDEBAR_PEEK_HIDE_DELAY_MS = 250;

/** Only the toggle and the left-edge zone open the peek; the others only keep it open. */
const openingRegions: ReadonlySet<SidebarPeekRegion> = new Set(["toggle", "edge"]);

interface SidebarPeekControllerOptions {
  onChange: (open: boolean) => void;
  delayMs?: number;
}

/**
 * The peek's transient state, separate from the pinned sidebar (spec
 * 2026-09-27 Review): one leave timer, cancelled while the pointer is on the
 * toggle, the edge zone, the peek sidebar or the top row above it. `hold`
 * (a context menu or rename in progress) postpones hiding.
 */
export class SidebarPeekController {
  private readonly hovered = new Set<SidebarPeekRegion>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private enabled = false;
  private hold = false;
  private open = false;

  constructor(private readonly options: SidebarPeekControllerOptions) {}

  get isOpen() {
    return this.open;
  }

  enter(region: SidebarPeekRegion) {
    this.hovered.add(region);

    if (!this.enabled) {
      return;
    }

    if (this.open) {
      this.cancelTimer();
      return;
    }

    if (openingRegions.has(region)) {
      this.setOpen(true);
    }
  }

  leave(region: SidebarPeekRegion) {
    this.hovered.delete(region);
    this.scheduleHideIfIdle();
  }

  /** Escape, pinning, or the sidebar becoming visible: hide now. */
  close() {
    this.cancelTimer();
    this.setOpen(false);
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;

    if (!enabled) {
      this.close();
    }
  }

  setHold(hold: boolean) {
    this.hold = hold;

    if (hold) {
      this.cancelTimer();
    } else {
      this.scheduleHideIfIdle();
    }
  }

  dispose() {
    this.cancelTimer();
  }

  private scheduleHideIfIdle() {
    if (!this.open || this.hold || this.hovered.size > 0 || this.timer !== null) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = null;

      if (!this.hold && this.hovered.size === 0) {
        this.setOpen(false);
      }
    }, this.options.delayMs ?? SIDEBAR_PEEK_HIDE_DELAY_MS);
  }

  private cancelTimer() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private setOpen(open: boolean) {
    if (this.open === open) {
      return;
    }

    this.open = open;

    if (!open) {
      // The peek sidebar unmounts, so no leave event will come for it.
      this.hovered.delete("sidebar");
    }

    this.options.onChange(open);
  }
}

/** React binding for {@link SidebarPeekController}; `enabled` is "the sidebar is not pinned". */
export function useSidebarPeek({ enabled, hold }: { enabled: boolean; hold: boolean }) {
  const [peekOpen, setPeekOpen] = useState(false);
  const controller = useMemo(() => new SidebarPeekController({ onChange: setPeekOpen }), []);

  useEffect(() => {
    controller.setEnabled(enabled);
  }, [controller, enabled]);

  useEffect(() => {
    controller.setHold(hold);
  }, [controller, hold]);

  useEffect(() => () => controller.dispose(), [controller]);

  const regionHandlers = useCallback(
    (region: SidebarPeekRegion) => ({
      onPointerEnter: () => controller.enter(region),
      onPointerLeave: () => controller.leave(region)
    }),
    [controller]
  );
  const closePeek = useCallback(() => controller.close(), [controller]);

  return { peekOpen, closePeek, regionHandlers };
}
