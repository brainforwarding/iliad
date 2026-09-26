// Streaming autocomplete partials (spec §2): only whole words that can no
// longer change are shown while a suggestion streams, at most every 100 ms.

import { containsReasoningMarkers } from "./sse.js";

/** The text up to the last whole word, once it holds at least three words; otherwise "". */
export function stableAutocompletePrefix(text: string) {
  const boundary = text.search(/\S+\s*$/u);
  const stable = boundary < 0 ? "" : text.slice(0, boundary);
  return stable.trim().split(/\s+/u).length >= 3 ? stable : "";
}

export const AUTOCOMPLETE_PARTIAL_INTERVAL_MS = 100;

/**
 * Feeds accumulated stream text; calls `emit` with a growing stable prefix.
 * Never emits text carrying reasoning/control markers.
 */
export function createAutocompletePartialEmitter(emit: (stable: string) => void, now: () => number = Date.now) {
  let emitted = "";
  let lastEmission = Number.NEGATIVE_INFINITY;
  return (text: string) => {
    const stable = stableAutocompletePrefix(text);
    if (!stable.startsWith(emitted) || stable.length <= emitted.length) return;
    if (now() - lastEmission < AUTOCOMPLETE_PARTIAL_INTERVAL_MS) return;
    if (containsReasoningMarkers(stable)) return;
    emitted = stable;
    lastEmission = now();
    emit(stable);
  };
}
