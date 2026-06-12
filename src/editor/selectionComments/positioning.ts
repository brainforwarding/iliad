export interface OverlayAnchorRect {
  top: number;
  bottom: number;
  left: number;
}

export interface OverlaySurfaceMetrics {
  rectTop: number;
  rectLeft: number;
  scrollTop: number;
  scrollLeft: number;
  width: number;
  viewportHeight: number;
}

export interface OverlaySize {
  width: number;
  height: number;
}

export interface OverlayPlacementOptions {
  anchor: OverlayAnchorRect;
  surface: OverlaySurfaceMetrics;
  size: OverlaySize;
  prefer: "above" | "below";
  gap?: number;
}

export interface OverlayPosition {
  left: number;
  top: number;
  placement: "above" | "below";
}

const VIEWPORT_MARGIN = 12;
const HORIZONTAL_MARGIN = 8;

/**
 * Converts viewport anchor coordinates (from `view.coordsAtPos()`) into
 * content coordinates inside `.editor-surface`, the scroll owner. Positioned
 * elements scroll with the document naturally; only layout reflows (e.g.
 * visualMarkdown syntax reveal) require recomputing the anchor, so callers
 * must never cache screen coordinates across layout changes.
 */
export function anchoredOverlayPosition({ anchor, surface, size, prefer, gap = 6 }: OverlayPlacementOptions): OverlayPosition {
  const fitsBelow = anchor.bottom + gap + size.height <= surface.viewportHeight - VIEWPORT_MARGIN;
  const fitsAbove = anchor.top - gap - size.height >= VIEWPORT_MARGIN;
  let placement: "above" | "below";

  if (prefer === "below") {
    placement = fitsBelow || !fitsAbove ? "below" : "above";
  } else {
    placement = fitsAbove || !fitsBelow ? "above" : "below";
  }

  const top =
    placement === "below"
      ? anchor.bottom - surface.rectTop + surface.scrollTop + gap
      : anchor.top - surface.rectTop + surface.scrollTop - size.height - gap;
  const rawLeft = anchor.left - surface.rectLeft + surface.scrollLeft;
  const maxLeft = Math.max(HORIZONTAL_MARGIN, surface.width - size.width - HORIZONTAL_MARGIN);
  const left = Math.min(Math.max(rawLeft, HORIZONTAL_MARGIN), maxLeft);

  return { left, top: Math.max(0, top), placement };
}
