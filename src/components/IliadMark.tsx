import { useCallback, useEffect, useRef } from "react";

interface IliadMarkProps {
  /** Rendered pixel width. Height follows the 64×72 viewBox aspect. */
  size?: number;
  /** Crash/error state: eyes shut, muted, no hop. */
  asleep?: boolean;
  className?: string;
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const
};

/**
 * Athena's owl — the Iliad signature mark. Inline SVG so it stays crisp at any DPI
 * and themes with the app palette.
 *
 * The owl perches on a fixed branch: `.iliad-mark__owl` is the only thing that moves,
 * so it hops *off* the static branch. Idle behaviour (gentle breathe + a smile-blink)
 * lives in mark.css; a rare hop + wing-flash is scheduled here. Everything is disabled
 * under prefers-reduced-motion.
 */
export function IliadMark({ size = 76, asleep = false, className }: IliadMarkProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const clearTimerRef = useRef(0);

  // Run one hop now: restart the CSS animation and clear it when it finishes.
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
      const delay = 30000 + Math.random() * 30000; // rare: every 30–60s
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

  // A click makes the owl hop on demand — playful, but still silent when asleep.
  const handleClick = () => {
    if (asleep || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    hop();
  };

  const classes = ["iliad-mark"];
  if (asleep) {
    classes.push("iliad-mark--asleep");
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
        {/* the owl — the only group that hops */}
        <g className="iliad-mark__owl">
          {/* folded wings that spring out on a hop */}
          <g className="iliad-mark__wings">
            <path
              className="iliad-mark__wing-l"
              {...stroke}
              fill="currentColor"
              fillOpacity={0.12}
              d="M16 34 C9 36 7 44 11 50 C15 47 17 41 18 36 Z"
            />
            <path
              className="iliad-mark__wing-r"
              {...stroke}
              fill="currentColor"
              fillOpacity={0.12}
              d="M48 34 C55 36 57 44 53 50 C49 47 47 41 46 36 Z"
            />
          </g>

          {/* ear tufts + head */}
          <g {...stroke}>
            <path d="M20 17 L26 22" />
            <path d="M44 17 L38 22" />
            <path d="M32 18 C44 18 51 27 51 38 C51 49 43 55 32 55 C21 55 13 49 13 38 C13 27 20 18 32 18 Z" />
          </g>

          {/* eyes: awake = open rings that blink to a smile arc; asleep = shut */}
          {asleep ? (
            <g className="iliad-mark__eyes-shut" {...stroke}>
              <path d="M17.5 32 Q24 38.5 30.5 32" />
              <path d="M33.5 32 Q40 38.5 46.5 32" />
            </g>
          ) : (
            <g className="iliad-mark__eyes">
              <g className="iliad-mark__eye-open">
                <circle cx="24" cy="33" r="6.5" {...stroke} />
                <circle cx="40" cy="33" r="6.5" {...stroke} />
                <circle cx="24" cy="33" r="2.4" fill="currentColor" />
                <circle cx="40" cy="33" r="2.4" fill="currentColor" />
              </g>
              <g className="iliad-mark__eye-closed" {...stroke}>
                <path d="M17.5 32 Q24 38.5 30.5 32" />
                <path d="M33.5 32 Q40 38.5 46.5 32" />
              </g>
            </g>
          )}

          {/* beak */}
          <path {...stroke} d="M29.5 38 L32 41 L34.5 38" />

          {asleep ? (
            <text className="iliad-mark__zzz" x="49" y="20" fill="currentColor" stroke="none">
              z
            </text>
          ) : null}
        </g>

        {/* branch + diagonal stem — stays put while the owl hops */}
        <g {...stroke}>
          <path d="M5 61 C20 63 42 62 55 59" />
          <path d="M15 60.5 C12 56 10 52 8 48" />
        </g>
      </svg>
    </span>
  );
}
