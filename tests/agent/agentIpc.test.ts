import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  fromWebContents: vi.fn(),
  handle: vi.fn(),
  getPath: vi.fn(() => "/tmp"),
  on: vi.fn(),
  openExternal: vi.fn()
}));

vi.mock("electron", () => ({
  app: {
    getPath: electronMock.getPath,
    on: electronMock.on
  },
  BrowserWindow: {
    fromWebContents: electronMock.fromWebContents
  },
  ipcMain: {
    handle: electronMock.handle
  },
  shell: {
    openExternal: electronMock.openExternal
  }
}));

describe("agent IPC trust validation", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    electronMock.fromWebContents.mockReset();
    electronMock.handle.mockReset();
    electronMock.getPath.mockReset();
    electronMock.getPath.mockReturnValue("/tmp");
    electronMock.on.mockReset();
    electronMock.openExternal.mockReset();
    delete process.env.VITE_DEV_SERVER_URL;
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  async function tempWorkspace() {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "iliad-agent-ipc-"));
    tempDirs.push(workspaceRoot);
    return workspaceRoot;
  }

  function trustedEvent() {
    electronMock.fromWebContents.mockReturnValue({});
    return {
      sender: {},
      senderFrame: { url: "file:///Applications/Iliad.app/index.html" }
    } as never;
  }

  it("rejects untrusted transcription senders before calling the service", async () => {
    const { handleTranscribeAudioIpc } = await import("../../electron/ipc/agent");
    const transcribeAudio = vi.fn();
    electronMock.fromWebContents.mockReturnValue(null);

    const response = handleTranscribeAudioIpc(
      {
        sender: {},
        senderFrame: { url: "file:///Applications/Iliad.app/index.html" }
      } as never,
      {
        requestId: "dictation-untrusted",
        audio: new Uint8Array([1]),
        mimeType: "audio/webm"
      },
      { transcribeAudio }
    );

    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(response).toEqual({
      requestId: "dictation-untrusted",
      text: "",
      error: {
        code: "unknown",
        userMessage: "The dictation request came from an untrusted window.",
        detail: "untrusted_ipc_sender",
        retryable: false
      }
    });
  });

  it("rejects untrusted Codex CLI probes", async () => {
    const { handleCodexCliProbeIpc } = await import("../../electron/ipc/agent");
    electronMock.fromWebContents.mockReturnValue(null);

    const response = handleCodexCliProbeIpc(
      {
        sender: {},
        senderFrame: { url: "file:///Applications/Iliad.app/index.html" }
      } as never,
      {
        executablePath: "/usr/local/bin/codex"
      }
    );

    expect(response).toEqual({
      ok: false,
      executablePath: "/usr/local/bin/codex",
      error: {
        code: "failed",
        message: "The Codex CLI probe came from an untrusted window.",
        detail: "untrusted_ipc_sender"
      }
    });
  });

  it("assembles Tighten output by replacing only the selected span", async () => {
    const { handleTightenIpc } = await import("../../electron/ipc/tighten");
    const text =
      "La conversación parte aquí porque toca el núcleo de la promesa escolar y tensiona la confianza.";
    const from = text.indexOf("porque toca");
    const to = text.indexOf(" y tensiona");
    const service = {
      tightenSelection: vi.fn(async () => "porque aborda la promesa escolar")
    };
    electronMock.fromWebContents.mockReturnValue({});
    const response = await handleTightenIpc(
      {
        sender: { id: 7 },
        senderFrame: { url: "file:///Applications/Iliad.app/index.html" }
      } as never,
      {
        requestId: "tighten-selected-only",
        text,
        language: "es",
        selection: { from, to }
      },
      { service, controllers: new Map() }
    );

    expect(response).toEqual({
      ok: true,
      rewrite: "La conversación parte aquí porque aborda la promesa escolar y tensiona la confianza.",
      unchanged: false
    });
    expect(service.tightenSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        text,
        selection: { from, to },
        language: "es"
      })
    );
  });

  it("passes custom edit instructions through the same selected-span assembly", async () => {
    const { handleTightenIpc } = await import("../../electron/ipc/tighten");
    const text = "You write best when the tool stays quiet and out of your way.";
    const from = text.indexOf("stays quiet and out of your way");
    const to = from + "stays quiet and out of your way".length;
    const service = {
      tightenSelection: vi.fn(async () => "disappears under your eye")
    };
    electronMock.fromWebContents.mockReturnValue({});
    const response = await handleTightenIpc(
      {
        sender: { id: 8 },
        senderFrame: { url: "file:///Applications/Iliad.app/index.html" }
      } as never,
      {
        requestId: "edit-selected-only",
        mode: "edit",
        instruction: "make it more vivid",
        text,
        language: "en",
        selection: { from, to }
      },
      { service, controllers: new Map() }
    );

    expect(response).toEqual({
      ok: true,
      rewrite: "You write best when the tool disappears under your eye.",
      unchanged: false
    });
    expect(service.tightenSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        text,
        selection: { from, to },
        language: "en",
        mode: "edit",
        instruction: "make it more vivid"
      })
    );
  });

  it("rejects empty custom edit instructions before calling the service", async () => {
    const { handleTightenIpc } = await import("../../electron/ipc/tighten");
    const service = {
      tightenSelection: vi.fn(async () => "unused")
    };
    electronMock.fromWebContents.mockReturnValue({});

    const response = await handleTightenIpc(
      {
        sender: { id: 9 },
        senderFrame: { url: "file:///Applications/Iliad.app/index.html" }
      } as never,
      {
        requestId: "edit-empty-instruction",
        mode: "edit",
        instruction: "   ",
        text: "Selected text",
        language: "en",
        selection: { from: 0, to: 8 }
      },
      { service, controllers: new Map() }
    );

    expect(response).toEqual({ ok: false, reason: "empty" });
    expect(service.tightenSelection).not.toHaveBeenCalled();
  });

  it("rejects untrusted autocomplete senders before calling the service", async () => {
    const { handleAutocompleteIpc } = await import("../../electron/ipc/autocomplete");
    const service = {
      autocompleteIdea: vi.fn(async () => " unused"),
      writingAssistStatus: vi.fn()
    };
    electronMock.fromWebContents.mockReturnValue(null);

    const response = await handleAutocompleteIpc(
      {
        sender: { id: 10 },
        senderFrame: { url: "file:///Applications/Iliad.app/index.html" }
      } as never,
      {
        requestId: "autocomplete-untrusted",
        workspaceSessionId: "session-1",
        documentRelativePath: "draft.md",
        prefix: "This paragraph has enough context",
        suffix: "",
        language: "en"
      },
      {
        service,
        controllers: new Map(),
        resolveWorkspaceRootForSession: async () => "/tmp/workspace"
      }
    );

    expect(response).toEqual({ ok: false, reason: "untrusted" });
    expect(service.autocompleteIdea).not.toHaveBeenCalled();
  });

  it("validates autocomplete workspace sessions and relative Markdown paths in main", async () => {
    const { handleAutocompleteIpc } = await import("../../electron/ipc/autocomplete");
    const workspaceRoot = await tempWorkspace();
    const service = {
      autocompleteIdea: vi.fn(async () => " next idea"),
      writingAssistStatus: vi.fn()
    };
    electronMock.fromWebContents.mockReturnValue({});

    const staleSession = await handleAutocompleteIpc(
      {
        sender: { id: 11 },
        senderFrame: { url: "file:///Applications/Iliad.app/index.html" }
      } as never,
      {
        requestId: "autocomplete-stale",
        workspaceSessionId: "wrong-session",
        documentRelativePath: "draft.md",
        prefix: "This paragraph has enough context",
        suffix: "",
        language: "en"
      },
      {
        service,
        controllers: new Map(),
        resolveWorkspaceRootForSession: async (_event, sessionId) => (sessionId === "session-1" ? workspaceRoot : null)
      }
    );
    const unsafePath = await handleAutocompleteIpc(
      {
        sender: { id: 11 },
        senderFrame: { url: "file:///Applications/Iliad.app/index.html" }
      } as never,
      {
        requestId: "autocomplete-unsafe",
        workspaceSessionId: "session-1",
        documentRelativePath: "../draft.md",
        prefix: "This paragraph has enough context",
        suffix: "",
        language: "en"
      },
      {
        service,
        controllers: new Map(),
        resolveWorkspaceRootForSession: async (_event, sessionId) => (sessionId === "session-1" ? workspaceRoot : null)
      }
    );

    expect(staleSession).toEqual({ ok: false, reason: "disabled" });
    expect(unsafePath).toEqual({ ok: false, reason: "disabled" });
    expect(service.autocompleteIdea).not.toHaveBeenCalled();
  });

  it("passes autocomplete API fallback only when explicitly enabled", async () => {
    const { handleAutocompleteIpc } = await import("../../electron/ipc/autocomplete");
    const workspaceRoot = await tempWorkspace();
    const service = {
      autocompleteIdea: vi.fn(async () => " next idea"),
      writingAssistStatus: vi.fn()
    };
    electronMock.fromWebContents.mockReturnValue({});

    const response = await handleAutocompleteIpc(
      {
        sender: { id: 12 },
        senderFrame: { url: "file:///Applications/Iliad.app/index.html" }
      } as never,
      {
        requestId: "autocomplete-valid",
        workspaceSessionId: "session-1",
        documentRelativePath: "draft.md",
        prefix: "This paragraph has enough context",
        suffix: "",
        headingPath: ["Draft"],
        documentTitle: "draft",
        nearbyHeadings: ["Draft"],
        language: "en",
        autocompleteApiFallbackEnabled: true
      },
      {
        service,
        controllers: new Map(),
        resolveWorkspaceRootForSession: async (_event, sessionId) => (sessionId === "session-1" ? workspaceRoot : null)
      }
    );

    expect(response).toEqual({ ok: true, insert: " next idea" });
    expect(service.autocompleteIdea).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "autocomplete-valid",
        prefix: "This paragraph has enough context",
        trigger: "automatic",
        suggestionKind: "inline",
        allowApiFallback: true
      })
    );
  });

  it("validates autocomplete trigger metadata and preserves explicit paragraph mode", async () => {
    const { handleAutocompleteIpc } = await import("../../electron/ipc/autocomplete");
    const workspaceRoot = await tempWorkspace();
    const service = {
      autocompleteIdea: vi.fn(async () => "\n\nThe next paragraph follows naturally."),
      writingAssistStatus: vi.fn()
    };
    electronMock.fromWebContents.mockReturnValue({});

    const response = await handleAutocompleteIpc(
      {
        sender: { id: 13 },
        senderFrame: { url: "file:///Applications/Iliad.app/index.html" }
      } as never,
      {
        requestId: "autocomplete-paragraph",
        workspaceSessionId: "session-1",
        documentRelativePath: "draft.md",
        prefix: "This paragraph has enough context.",
        suffix: "",
        language: "en",
        trigger: "manual",
        suggestionKind: "paragraph",
        autocompleteApiFallbackEnabled: false
      },
      {
        service,
        controllers: new Map(),
        resolveWorkspaceRootForSession: async (_event, sessionId) => (sessionId === "session-1" ? workspaceRoot : null)
      }
    );

    expect(response).toEqual({ ok: true, insert: "\n\nThe next paragraph follows naturally." });
    expect(service.autocompleteIdea).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: "manual",
        suggestionKind: "paragraph",
        allowApiFallback: false
      })
    );
  });

  it("rejects untrusted Codex account IPC calls before calling the service", async () => {
    const {
      handleCodexCancelLoginIpc,
      handleCodexLogoutIpc,
      handleCodexStartDeviceLoginIpc,
      handleCodexStatusIpc
    } = await import("../../electron/ipc/agent");
    electronMock.fromWebContents.mockReturnValue(null);
    const event = {
      sender: {},
      senderFrame: { url: "file:///Applications/Iliad.app/index.html" }
    } as never;
    const service = {
      codexStatus: vi.fn(),
      startCodexDeviceLogin: vi.fn(),
      cancelCodexLogin: vi.fn(),
      logoutCodex: vi.fn()
    };

    expect(handleCodexStatusIpc(event, service)).toMatchObject({
      available: false,
      error: { code: "untrusted_ipc_sender" }
    });
    expect(handleCodexStartDeviceLoginIpc(event, service)).toMatchObject({
      available: false,
      error: { code: "untrusted_ipc_sender" }
    });
    expect(handleCodexCancelLoginIpc(event, service)).toMatchObject({
      available: false,
      error: { code: "untrusted_ipc_sender" }
    });
    expect(handleCodexLogoutIpc(event, service)).toMatchObject({
      available: false,
      error: { code: "untrusted_ipc_sender" }
    });
    expect(service.codexStatus).not.toHaveBeenCalled();
    expect(service.startCodexDeviceLogin).not.toHaveBeenCalled();
    expect(service.cancelCodexLogin).not.toHaveBeenCalled();
    expect(service.logoutCodex).not.toHaveBeenCalled();
  });

  it("rejects untrusted Codex device URL opens and opens only the fixed allowlisted URL for trusted senders", async () => {
    const { handleCodexOpenDeviceLoginIpc } = await import("../../electron/ipc/agent");
    const openExternal = vi.fn();

    electronMock.fromWebContents.mockReturnValue(null);
    await expect(
      handleCodexOpenDeviceLoginIpc(
        {
          sender: {},
          senderFrame: { url: "file:///Applications/Iliad.app/index.html" }
        } as never,
        { openExternal }
      )
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "untrusted_ipc_sender" }
    });
    expect(openExternal).not.toHaveBeenCalled();

    electronMock.fromWebContents.mockReturnValue({});
    await expect(
      handleCodexOpenDeviceLoginIpc(
        {
          sender: {},
          senderFrame: { url: "file:///Applications/Iliad.app/index.html" }
        } as never,
        { openExternal }
      )
    ).resolves.toEqual({ ok: true });
    expect(openExternal).toHaveBeenCalledWith("https://auth.openai.com/codex/device");
  });

  it("lists Markdown context document metadata through a main-process workspace resolver", async () => {
    const { handleListMarkdownContextDocumentsIpc } = await import("../../electron/ipc/agent");
    const workspaceRoot = await tempWorkspace();
    await mkdir(path.join(workspaceRoot, "notes"), { recursive: true });
    await writeFile(path.join(workspaceRoot, "notes", "manual.md"), "MANUAL_LIST_CONTENT_SENTINEL", "utf8");
    await writeFile(path.join(workspaceRoot, "notes", "plain.txt"), "Plain", "utf8");
    const resolveWorkspaceRoot = vi.fn(async () => workspaceRoot);

    const response = await handleListMarkdownContextDocumentsIpc(trustedEvent(), "session-test", resolveWorkspaceRoot);

    expect(resolveWorkspaceRoot).toHaveBeenCalledWith(expect.anything(), "session-test");
    expect(response.files).toEqual([
      expect.objectContaining({
        relativePath: "notes/manual.md",
        name: "manual.md",
        sizeBytes: Buffer.byteLength("MANUAL_LIST_CONTENT_SENTINEL", "utf8"),
        estimatedTokens: expect.any(Number)
      })
    ]);
    expect(response.truncated).toBe(false);
    expect(JSON.stringify(response)).not.toContain("MANUAL_LIST_CONTENT_SENTINEL");
  });

  it("normalizes external context drops only for visible Markdown files inside the resolved workspace", async () => {
    const { handleNormalizeContextDropIpc } = await import("../../electron/ipc/agent");
    const workspaceRoot = await tempWorkspace();
    const outsideRoot = await tempWorkspace();
    await mkdir(path.join(workspaceRoot, "notes"), { recursive: true });
    const markdownPath = path.join(workspaceRoot, "notes", "manual.md");
    const textPath = path.join(workspaceRoot, "notes", "manual.txt");
    await writeFile(markdownPath, "# Manual\n", "utf8");
    await writeFile(textPath, "Plain", "utf8");
    await writeFile(path.join(outsideRoot, "outside.md"), "# Outside\n", "utf8");
    const resolveWorkspaceRoot = vi.fn(async () => workspaceRoot);

    await expect(handleNormalizeContextDropIpc(trustedEvent(), "session-test", markdownPath, resolveWorkspaceRoot)).resolves.toEqual({
      ok: true,
      relativePath: "notes/manual.md"
    });
    await expect(handleNormalizeContextDropIpc(trustedEvent(), "session-test", textPath, resolveWorkspaceRoot)).resolves.toEqual({
      ok: false,
      reason: "not_markdown"
    });
    await expect(
      handleNormalizeContextDropIpc(
        trustedEvent(),
        "session-test",
        path.join(outsideRoot, "outside.md"),
        resolveWorkspaceRoot
      )
    ).resolves.toEqual({
      ok: false,
      reason: "outside_workspace"
    });
  });

  it("starts external capture only through the resolved workspace session", async () => {
    const { handleStartExternalCaptureIpc } = await import("../../electron/ipc/agent");
    const workspaceRoot = await tempWorkspace();
    const resolveWorkspaceRoot = vi.fn(async () => workspaceRoot);
    const startExternalCapture = vi.fn(async () => ({
      captureId: "capture-ipc",
      workspaceRoot,
      startedAt: "2026-06-17T12:00:00.000Z",
      markdownFileCount: 1
    }));

    const response = await handleStartExternalCaptureIpc(
      trustedEvent(),
      { workspaceSessionId: "session-test", workspaceRoot: "/untrusted", agentName: "Claude" },
      { startExternalCapture },
      resolveWorkspaceRoot
    );

    expect(resolveWorkspaceRoot).toHaveBeenCalledWith(expect.anything(), "session-test");
    expect(startExternalCapture).toHaveBeenCalledWith({ workspaceRoot, agentName: "Claude" });
    expect(response.captureId).toBe("capture-ipc");
  });

  it("rejects untrusted external capture senders before calling the service", async () => {
    const { handleStartExternalCaptureIpc } = await import("../../electron/ipc/agent");
    const startExternalCapture = vi.fn();
    electronMock.fromWebContents.mockReturnValue(null);

    await expect(
      handleStartExternalCaptureIpc(
        {
          sender: {},
          senderFrame: { url: "file:///Applications/Iliad.app/index.html" }
        } as never,
        { workspaceSessionId: "session-test" },
        { startExternalCapture },
        vi.fn(async () => "/workspace")
      )
    ).rejects.toThrow("untrusted window");
    expect(startExternalCapture).not.toHaveBeenCalled();
  });

  it("trusts production file frames only when they belong to an app window", async () => {
    const { isTrustedAgentIpcSender } = await import("../../electron/ipc/agent");
    electronMock.fromWebContents.mockReturnValue({});

    expect(
      isTrustedAgentIpcSender({
        sender: {},
        senderFrame: { url: "file:///Applications/Iliad.app/index.html" }
      } as never)
    ).toBe(true);

    expect(
      isTrustedAgentIpcSender({
        sender: {},
        senderFrame: { url: "https://example.com/" }
      } as never)
    ).toBe(false);
  });

  it("trusts dev frames only when their origin matches VITE_DEV_SERVER_URL", async () => {
    const { isTrustedAgentIpcSender } = await import("../../electron/ipc/agent");
    process.env.VITE_DEV_SERVER_URL = "http://127.0.0.1:5173";
    electronMock.fromWebContents.mockReturnValue({});

    expect(
      isTrustedAgentIpcSender({
        sender: {},
        senderFrame: { url: "http://127.0.0.1:5173/src/main.tsx" }
      } as never)
    ).toBe(true);

    expect(
      isTrustedAgentIpcSender({
        sender: {},
        senderFrame: { url: "http://localhost:5173/src/main.tsx" }
      } as never)
    ).toBe(false);
  });
});
