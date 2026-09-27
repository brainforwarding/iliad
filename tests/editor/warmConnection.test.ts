import { describe, expect, it, vi } from "vitest";
import { WARM_CONNECTION_THROTTLE_MS, createWarmConnectionThrottle } from "../../src/editor/ideaAutocomplete/warmConnection";

describe("createWarmConnectionThrottle", () => {
  it("sends at most one warm-up IPC per minute however often the writer types or focuses", () => {
    let now = 1_000;
    const warm = vi.fn();
    const throttled = createWarmConnectionThrottle(warm, WARM_CONNECTION_THROTTLE_MS, () => now);
    throttled();
    throttled();
    now += WARM_CONNECTION_THROTTLE_MS - 1;
    throttled();
    expect(warm).toHaveBeenCalledOnce();
    now += 1;
    throttled();
    expect(warm).toHaveBeenCalledTimes(2);
    expect(WARM_CONNECTION_THROTTLE_MS).toBe(60_000);
  });
});
