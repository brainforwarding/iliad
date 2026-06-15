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
});
