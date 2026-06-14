import { useCallback, useEffect, useRef } from "react";

interface ClipMarkProps {
  /** Rendered pixel width. Height follows the 64x96 viewBox aspect. */
  size?: number;
  /** Crash/error state: muted, drooped, no hop. */
  asleep?: boolean;
  className?: string;
}

/**
 * Flow's faceless paperclip mark. Inline SVG so it stays crisp at any DPI and
 * themes with the app palette.
 */
export function ClipMark({ size = 76, asleep = false, className }: ClipMarkProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const clearTimerRef = useRef(0);

  const hop = useCallback(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    window.clearTimeout(clearTimerRef.current);
    el.classList.remove("is-hop");
    void el.offsetWidth; // restart the animation
    el.classList.add("is-hop");
    clearTimerRef.current = window.setTimeout(() => el.classList.remove("is-hop"), 820);
  }, []);

  useEffect(() => {
    if (asleep || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    let hopTimer = 0;

    const scheduleHop = () => {
      const delay = 30000 + Math.random() * 30000;
      hopTimer = window.setTimeout(() => {
        hop();
        scheduleHop();
      }, delay);
    };

    scheduleHop();
    return () => {
      window.clearTimeout(hopTimer);
      window.clearTimeout(clearTimerRef.current);
    };
  }, [asleep, hop]);

  const handleClick = () => {
    if (asleep || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    hop();
  };

  const classes = ["clip-mark"];
  if (asleep) {
    classes.push("clip-mark--asleep");
  }
  if (className) {
    classes.push(className);
  }

  return (
    <span ref={ref} className={classes.join(" ")} aria-hidden="true" onClick={handleClick}>
      <svg
        viewBox="0 0 64 96"
        width={size}
        height={Math.round((size * 96) / 64)}
        role="presentation"
        focusable="false"
      >
        <ellipse className="clip-mark__shadow" cx="32" cy="90" rx="15" ry="3" />
        <g className="clip-mark__clip">
          <g transform="translate(11 4) scale(2.4)">
            <path className="clip-mark__wire" d="M5 9.5 V23 a3 3 0 0 0 6 0 V7 a4.5 4.5 0 0 0 -9 0 v17 a6.5 6.5 0 0 0 13 0 V10" />
          </g>
          <text className="clip-mark__zzz" x="47" y="16">
            z
          </text>
        </g>
      </svg>
    </span>
  );
}
