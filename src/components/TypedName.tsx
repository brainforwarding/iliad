import { useEffect, useState } from "react";

/** The whole name types itself in about half a second. */
export const typedNameDurationMs = 500;
const minimumStepMs = 16;

function prefersReducedMotion() {
  try {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}

/**
 * A name that types itself (spec 2026-09-27 "Name untitled documents",
 * Figma board 89:3): letter by letter with a thin caret, then a small ✦ that
 * fades. Purely visual — the accessible text is the final name from the first
 * frame, and with reduced motion the name simply appears.
 */
export function TypedName({ text }: { text: string }) {
  const characters = [...text];
  const [reduced] = useState(prefersReducedMotion);
  const [shown, setShown] = useState(() => (reduced ? characters.length : 0));
  const typing = shown < characters.length;

  useEffect(() => {
    if (reduced || !typing) {
      return;
    }

    const step = Math.max(minimumStepMs, Math.floor(typedNameDurationMs / Math.max(1, characters.length)));
    const timer = window.setTimeout(() => setShown((count) => Math.min(characters.length, count + 1)), step);

    return () => window.clearTimeout(timer);
  }, [characters.length, reduced, shown, typing]);

  return (
    <span className={`typed-name${typing ? " is-typing" : ""}${reduced ? " is-reduced" : ""}`}>
      <span className="sr-only">{text}</span>
      <span className="typed-name-text" aria-hidden="true">
        {characters.slice(0, shown).join("")}
        {typing ? <span className="typed-name-caret" /> : null}
      </span>
      {reduced ? null : (
        <span className="typed-name-spark" aria-hidden="true">
          ✦
        </span>
      )}
    </span>
  );
}
