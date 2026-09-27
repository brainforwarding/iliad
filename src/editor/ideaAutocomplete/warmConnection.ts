/**
 * Renderer-side throttle for the AI connection warm-up: typing and focus call
 * it freely, IPC goes out at most once per interval. Main rate-limits again
 * per endpoint (electron/writing/groq/connection.ts), so this only saves IPC.
 */
export const WARM_CONNECTION_THROTTLE_MS = 60_000;

export function createWarmConnectionThrottle(warm: () => void, intervalMs = WARM_CONNECTION_THROTTLE_MS, now: () => number = Date.now) {
  let last: number | null = null;
  return () => {
    const at = now();
    if (last !== null && at - last < intervalMs) return;
    last = at;
    warm();
  };
}
