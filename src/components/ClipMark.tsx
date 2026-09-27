import { useCallback, useEffect, useRef } from "react";

interface ClipMarkProps {
  /** Rendered pixel width. Height follows the 64x72 viewBox aspect. */
  size?: number;
  /** Crash/error state: muted, drooped, no hop. */
  asleep?: boolean;
  className?: string;
}

/**
 * Iliad's faceless paperclip mark: the 45° clip (logo option 1B, 24-unit grid,
 * 1.8 stroke). Inline SVG so it stays crisp at any DPI and themes with the app
 * palette.
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
        viewBox="0 0 64 72"
        width={size}
        height={Math.round((size * 72) / 64)}
        role="presentation"
        focusable="false"
      >
        <ellipse className="clip-mark__shadow" cx="32" cy="66" rx="15" ry="3" />
        <g className="clip-mark__clip">
          <g transform="translate(-1.84 -3.32) scale(3)">
            <path className="clip-mark__wire" d="M18.45 13.36L13.36 18.45C12.32 19.48 10.92 20.07 9.45 20.07C7.99 20.07 6.59 19.48 5.55 18.45C4.52 17.41 3.93 16.01 3.93 14.55C3.93 13.08 4.52 11.68 5.55 10.64L11.66 4.53C12.43 3.77 13.46 3.34 14.55 3.34C15.63 3.34 16.67 3.77 17.43 4.53C18.2 5.3 18.63 6.34 18.63 7.42C18.63 8.5 18.2 9.54 17.43 10.3L11.32 16.41C10.83 16.91 10.15 17.19 9.45 17.19C8.75 17.19 8.08 16.91 7.59 16.41C7.09 15.92 6.81 15.25 6.81 14.55C6.81 13.85 7.09 13.17 7.59 12.68L14.04 6.23" />
          </g>
          <text className="clip-mark__zzz" x="6" y="14">
            z
          </text>
        </g>
      </svg>
    </span>
  );
}
