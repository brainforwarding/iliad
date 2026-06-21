import { describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  fromWebContents: vi.fn(),
  handle: vi.fn()
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    fromWebContents: electronMock.fromWebContents,
    getFocusedWindow: vi.fn()
  },
  dialog: {
    showOpenDialog: vi.fn()
  },
  ipcMain: {
    handle: electronMock.handle
  }
}));

describe("workspace file watching", () => {
  it("refreshes the file tree for structural filesystem events only", async () => {
    const { workspaceWatchEventNeedsTreeRefresh } = await import("../../electron/ipc/workspace");

    expect(workspaceWatchEventNeedsTreeRefresh("rename")).toBe(true);
    expect(workspaceWatchEventNeedsTreeRefresh("change")).toBe(false);
    expect(workspaceWatchEventNeedsTreeRefresh(null)).toBe(false);
    expect(workspaceWatchEventNeedsTreeRefresh(undefined)).toBe(false);
  });

  it("detects visible Markdown content changes", async () => {
    const { workspaceWatchEventIsMarkdownChange } = await import("../../electron/ipc/workspace");

    expect(workspaceWatchEventIsMarkdownChange("change", "notes/example.md")).toBe(true);
    expect(workspaceWatchEventIsMarkdownChange("rename", "notes/example.markdown")).toBe(true);
    expect(workspaceWatchEventIsMarkdownChange("change", "notes/example.txt")).toBe(false);
    expect(workspaceWatchEventIsMarkdownChange("change", ".hidden/example.md")).toBe(false);
    expect(workspaceWatchEventIsMarkdownChange("change", "node_modules/example.md")).toBe(false);
    expect(workspaceWatchEventIsMarkdownChange("change", "__tmp-example.md")).toBe(false);
    expect(workspaceWatchEventIsMarkdownChange("change", "notes/__tmp-example.md")).toBe(false);
    expect(workspaceWatchEventIsMarkdownChange("change", null)).toBe(false);
    expect(workspaceWatchEventIsMarkdownChange(null, "notes/example.md")).toBe(false);
  });

  it("matches Iliad-owned mutation markers by workspace and path", async () => {
    const {
      clearWorkspaceMutationMarkersForTests,
      markWorkspaceMutation,
      workspaceMutationMarkerMatches
    } = await import("../../electron/fs/workspaceMutationMarkers");
    const workspaceRoot = "/tmp/iliad-marker-workspace";

    clearWorkspaceMutationMarkersForTests();
    markWorkspaceMutation(workspaceRoot, ["/tmp/iliad-marker-workspace/notes/example.md"], 1000);

    expect(workspaceMutationMarkerMatches(workspaceRoot, "notes/example.md")).toBe(true);
    expect(workspaceMutationMarkerMatches(workspaceRoot, "notes/other.md")).toBe(false);

    markWorkspaceMutation(workspaceRoot, undefined, 1000);

    expect(workspaceMutationMarkerMatches(workspaceRoot, "notes/other.md")).toBe(true);
    clearWorkspaceMutationMarkersForTests();
  });
});
