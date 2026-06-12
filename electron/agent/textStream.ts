import type { AgentProviderRunEvent } from "./types.js";

// Main-side coalescing gate for answer-text deltas (the emitSummaryDelta
// precedent): bounded IPC volume regardless of token rate, force-flushed at
// payload end. Timer-free by design — flushes ride on the next push or the
// explicit flush() — so there is nothing to leak or fire late.
export const textDeltaFlushIntervalMs = 120;

export interface TextDeltaEmitter {
  /**
   * Starts a new streamed payload (tool round, retry, fallback restart). The
   * renderer replaces its buffer when the generation changes, so intermediate
   * rounds and retried prefixes can never duplicate in the visible stream.
   */
  nextGeneration(): void;
  push(delta: string): void;
  flush(): void;
}

export function createTextDeltaEmitter(
  runId: string,
  onRunEvent: ((event: AgentProviderRunEvent) => void) | undefined,
  now: () => number = Date.now
): TextDeltaEmitter {
  let generation = 0;
  let buffer = "";
  let lastFlushAt = 0;

  const emit = () => {
    if (!buffer || !onRunEvent || generation === 0) {
      buffer = "";
      return;
    }

    onRunEvent({ type: "text_delta", runId, generation, delta: buffer });
    buffer = "";
    lastFlushAt = now();
  };

  return {
    nextGeneration() {
      buffer = "";
      generation += 1;
      lastFlushAt = 0;
    },
    push(delta: string) {
      if (!delta) {
        return;
      }

      buffer += delta;

      if (now() - lastFlushAt >= textDeltaFlushIntervalMs) {
        emit();
      }
    },
    flush() {
      emit();
    }
  };
}
