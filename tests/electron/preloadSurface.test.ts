import { beforeAll, describe, expect, it, vi } from "vitest";

const exposed = vi.hoisted(() => ({ api: null as Record<string, unknown> | null }));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (_key: string, api: Record<string, unknown>) => {
      exposed.api = api;
    }
  },
  ipcRenderer: {
    invoke: vi.fn(() => Promise.resolve(undefined)),
    on: vi.fn(),
    removeListener: vi.fn()
  },
  webUtils: { getPathForFile: vi.fn() }
}));

beforeAll(async () => {
  await import("../../electron/preload");
});

describe("preload API surface", () => {
  it("exposes no internal agent run, remote, or dictation entry points", () => {
    const api = exposed.api;
    expect(api).not.toBeNull();
    const agent = api?.agent as Record<string, unknown>;

    expect(agent.startRun).toBeUndefined();
    expect(api?.remote).toBeUndefined();
    expect(agent.transcribeAudio).toBeUndefined();
    expect(JSON.stringify(Object.keys(api ?? {}))).not.toMatch(/transcribe/i);
    expect(Object.keys(agent).sort()).toEqual([
      "applyProposalFile",
      "getExternalReview",
      "onExternalReviewChanged",
      "rejectProposal",
      "rejectProposalFile"
    ]);
  });

  it("exposes the CLI bridge (active document and open requests)", () => {
    const cli = exposed.api?.cli as Record<string, unknown>;
    expect(Object.keys(cli).sort()).toEqual(["completeOpenRequest", "onOpenRequested", "setActiveDocument", "takeOpenRequest"]);
  });

  it("exposes the Gemini key state and setter", () => {
    expect(typeof exposed.api?.getGeminiKeyState).toBe("function");
    expect(typeof exposed.api?.setGeminiApiKey).toBe("function");
  });
});
