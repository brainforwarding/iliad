import { useEffect, useState, type RefObject } from "react";
import { commentMarginFits } from "./layout";

/** Whether the editor surface is wide enough for the comment margin; follows resizes. */
export function useCommentMarginFit(surfaceRef: RefObject<HTMLElement | null>, enabled: boolean) {
  const [fits, setFits] = useState(true);

  useEffect(() => {
    const surface = surfaceRef.current;

    if (!enabled || !surface) {
      return;
    }

    const update = () => setFits(commentMarginFits(surface.clientWidth));
    update();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(update);
    observer.observe(surface);

    return () => observer.disconnect();
  }, [enabled, surfaceRef]);

  return fits;
}
