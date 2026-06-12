import { describe, expect, it } from "vitest";
import { buildRunOutcomeEntry } from "../../src/assistant/runEntries";
import type { AgentActivityRunEvent, AgentRunContextManifest } from "../../src/types/iliad";

function activity(overrides: Partial<AgentActivityRunEvent>): AgentActivityRunEvent {
  return {
    type: "activity",
    runId: "run-1",
    activityId: "read",
    sequence: 1,
    kind: "document_read",
    status: "completed",
    title: "raw",
    relativePath: "a.md",
    ...overrides
  };
}

const manifest = { id: "manifest-run-1", runId: "run-1", status: "failed" } as unknown as AgentRunContextManifest;

describe("buildRunOutcomeEntry", () => {
  it("attaches sorted activities to a successful assistant entry", () => {
    const entry = buildRunOutcomeEntry({
      runId: "run-1",
      kind: "assistant",
      text: "Answer",
      createdAt: "2026-06-11T12:00:00.000Z",
      contextManifest: manifest,
      activities: [activity({ activityId: "late", sequence: 2 }), activity({ activityId: "early", sequence: 1 })]
    });

    expect(entry.id).toBe("run-1-assistant");
    expect(entry.kind).toBe("assistant");
    expect(entry.contextManifest).toBe(manifest);
    expect(entry.activities?.map((item) => item.activityId)).toEqual(["early", "late"]);
  });

  it("attaches the failed-run manifest and activities to an error entry", () => {
    const entry = buildRunOutcomeEntry({
      runId: "run-1",
      kind: "error",
      text: "Agent request failed.",
      createdAt: "2026-06-11T12:00:00.000Z",
      contextManifest: manifest,
      activities: [activity({})]
    });

    expect(entry.id).toBe("run-1-error");
    expect(entry.contextManifest).toBe(manifest);
    expect(entry.activities).toHaveLength(1);
  });

  it("supports the thrown-exception path: activities without a manifest", () => {
    const entry = buildRunOutcomeEntry({
      runId: "run-1",
      kind: "error",
      text: "Network down",
      createdAt: "2026-06-11T12:00:00.000Z",
      activities: [activity({})]
    });

    expect(entry.contextManifest).toBeUndefined();
    expect("contextManifest" in entry).toBe(false);
    expect(entry.activities).toHaveLength(1);
  });

  it("omits the activities field entirely when the run produced none", () => {
    const entry = buildRunOutcomeEntry({
      runId: "run-1",
      kind: "assistant",
      text: "Answer",
      createdAt: "2026-06-11T12:00:00.000Z",
      contextManifest: manifest,
      activities: []
    });

    expect("activities" in entry).toBe(false);
  });
});
