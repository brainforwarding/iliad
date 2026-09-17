// Session-only counters: no prose, paths, credentials, or external telemetry.
const counts = { requested: 0, shown: 0, accepted: 0, wordsAccepted: 0, undone: 0, timeouts: 0 };
const visibleLatencies: number[] = [];
export function recordAutocompleteMetric(event: keyof typeof counts, latencyMs?: number) {
  counts[event] += 1;
  if (event === "shown" && latencyMs !== undefined) {
    visibleLatencies.push(Math.max(0, latencyMs));
    if (visibleLatencies.length > 200) visibleLatencies.shift();
  }
}
export function autocompleteMetricsSnapshot() {
  const sorted = [...visibleLatencies].sort((a, b) => a - b);
  const percentile = (p: number) => sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null;
  return { ...counts, pauseToVisibleP50: percentile(0.5), pauseToVisibleP95: percentile(0.95), sampleCount: sorted.length };
}
