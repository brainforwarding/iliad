import { describe, expect, it } from "vitest";
import { createTextDeltaEmitter, textDeltaFlushIntervalMs } from "../../electron/agent/textStream";
import type { AgentProviderRunEvent } from "../../electron/agent/types";

function harness(startAt = 1_000) {
  const events: AgentProviderRunEvent[] = [];
  let nowValue = startAt;
  const emitter = createTextDeltaEmitter("run-1", (event) => events.push(event), () => nowValue);
  return { events, emitter, advance: (ms: number) => (nowValue += ms) };
}

describe("text delta emitter", () => {
  it("coalesces deltas inside the flush window and force-flushes on demand", () => {
    const { events, emitter, advance } = harness();
    emitter.nextGeneration();

    emitter.push("Hola");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "text_delta", generation: 1, delta: "Hola" });

    emitter.push(" mun");
    emitter.push("do");
    expect(events).toHaveLength(1);

    advance(textDeltaFlushIntervalMs);
    emitter.push("!");
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ delta: " mundo!" });

    emitter.push(" fin");
    emitter.flush();
    expect(events[2]).toMatchObject({ delta: " fin" });
  });

  it("bumps the generation per payload and drops buffered text across generations", () => {
    const { events, emitter } = harness();
    emitter.nextGeneration();
    emitter.push("ronda 1");
    emitter.push(" pendiente");
    emitter.nextGeneration();
    emitter.push("ronda 2");
    emitter.flush();

    expect(events.map((event) => (event.type === "text_delta" ? [event.generation, event.delta] : null))).toEqual([
      [1, "ronda 1"],
      [2, "ronda 2"]
    ]);
  });

  it("emits nothing before nextGeneration, without a listener, or with empty buffers", () => {
    const { events, emitter } = harness();
    emitter.push("ignored");
    emitter.flush();
    expect(events).toEqual([]);

    const silent = createTextDeltaEmitter("run-1", undefined);
    silent.nextGeneration();
    silent.push("x");
    silent.flush();
  });
});
