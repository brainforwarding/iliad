import type { AgentTextRunEvent } from "../types/iliad";

export interface StreamingTextState {
  generation: number;
  text: string;
}

export const emptyStreamingText: StreamingTextState = { generation: 0, text: "" };

/**
 * Pure reducer for answer-text deltas: append within a generation, replace
 * when the generation changes (each streamed payload — tool round, retry —
 * starts a new generation in main, so stale rounds can never concatenate).
 */
export function applyTextDelta(state: StreamingTextState, event: Pick<AgentTextRunEvent, "generation" | "delta">): StreamingTextState {
  return event.generation === state.generation
    ? { generation: state.generation, text: state.text + event.delta }
    : { generation: event.generation, text: event.delta };
}

// Case-insensitive, mirroring proposalDrafts' /gi parsing: a case-variant
// marker the parser would honor must also stop the visible stream.
const streamCutMarkers = ["```diff", "full_replacement:", "new_document:", "delete_document:", "<<<<<<< search"];

/**
 * The prose shown while streaming: everything before the first proposal
 * marker, with a longest-prefix holdback on the tail so a marker split across
 * deltas never flashes ("FULL_REPLA…") before vanishing.
 */
export function visibleStreamingText(text: string): string {
  const lower = text.toLowerCase();
  let cut = text.length;

  for (const marker of streamCutMarkers) {
    const index = lower.indexOf(marker);

    if (index !== -1 && index < cut) {
      cut = index;
    }
  }

  let holdback = 0;

  for (const marker of streamCutMarkers) {
    const maxPrefix = Math.min(marker.length - 1, cut);

    for (let length = maxPrefix; length > 0; length -= 1) {
      if (lower.startsWith(marker.slice(0, length), cut - length)) {
        holdback = Math.max(holdback, length);
        break;
      }
    }
  }

  return text.slice(0, cut - holdback);
}

/**
 * Bottom-stickiness for the transcript: auto-scroll follows the stream only
 * while the user is already at (or near) the bottom.
 */
export function isScrolledToBottom(
  element: Pick<HTMLDivElement, "scrollHeight" | "scrollTop" | "clientHeight">,
  thresholdPx = 32
): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= thresholdPx;
}
