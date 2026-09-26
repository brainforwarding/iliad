import { useEffect, useLayoutEffect, useRef, useState } from "react";

const SHOW_DELAY_MS = 2500;
const GAP = 6;
const EDGE_MARGIN = 8;

interface Box { left: number; top: number; width: number; height: number }

/**
 * Below the anchor, centred on it, then shifted so the whole tooltip stays
 * inside the window. Flips above when there is no room below.
 */
export function placeTooltip(anchor: Box, tip: { width: number; height: number }, viewport: { width: number; height: number }) {
  const maxLeft = viewport.width - EDGE_MARGIN - tip.width;
  const centred = anchor.left + anchor.width / 2 - tip.width / 2;
  const left = Math.max(EDGE_MARGIN, Math.min(centred, maxLeft));
  const below = anchor.top + anchor.height + GAP;
  const top = below + tip.height > viewport.height - EDGE_MARGIN ? Math.max(EDGE_MARGIN, anchor.top - GAP - tip.height) : below;
  return { left, top };
}

/**
 * The one renderer for every `data-tooltip` attribute. CSS pseudo-element
 * tooltips cannot see the window edge, so labels near it were cut off.
 */
export function TooltipLayer() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let timer = 0;
    let pending: HTMLElement | null = null;
    const hide = () => { window.clearTimeout(timer); pending = null; setTarget(null); setPosition(null); };
    const onOver = (event: PointerEvent) => {
      const element = (event.target as Element | null)?.closest?.<HTMLElement>("[data-tooltip]") ?? null;
      if (element === pending) return;
      hide();
      if (!element || !element.dataset.tooltip) return;
      pending = element;
      timer = window.setTimeout(() => setTarget(element), SHOW_DELAY_MS);
    };
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    document.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      document.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  useLayoutEffect(() => {
    if (!target || !tipRef.current) return;
    const tip = tipRef.current.getBoundingClientRect();
    setPosition(placeTooltip(target.getBoundingClientRect(), tip, { width: window.innerWidth, height: window.innerHeight }));
  }, [target]);

  if (!target?.isConnected) return null;
  return (
    <div ref={tipRef} className={position ? "app-tooltip is-visible" : "app-tooltip"} role="tooltip"
      style={position ?? { left: 0, top: 0 }}>
      {target.dataset.tooltip}
    </div>
  );
}
