import { describe, expect, it, vi } from "vitest";
import {
  handleIsFullscreenIpc,
  isMenuCommand,
  menuCommandChannel,
  sendMenuCommand,
  watchWindowFullscreen,
  windowFullscreenChangedChannel
} from "../../electron/ipc/window";

const trusted = vi.hoisted(() => ({ value: true }));

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: () => (trusted.value ? {} : null) }
}));

const event = { sender: { id: 3 }, senderFrame: { url: "file:///app/index.html" } } as never;

function fakeWindow() {
  const listeners: Record<string, () => void> = {};
  return {
    destroyed: false,
    listeners,
    on: vi.fn((name: string, listener: () => void) => {
      listeners[name] = listener;
    }),
    isDestroyed() {
      return this.destroyed;
    },
    webContents: { send: vi.fn() }
  };
}

describe("window IPC", () => {
  it("answers the sender window's full-screen state, false when untrusted", () => {
    trusted.value = true;
    expect(handleIsFullscreenIpc(event, () => ({ isFullScreen: () => true }))).toBe(true);
    expect(handleIsFullscreenIpc(event, () => ({ isFullScreen: () => false }))).toBe(false);
    expect(handleIsFullscreenIpc(event, () => null)).toBe(false);
    trusted.value = false;
    expect(handleIsFullscreenIpc(event, () => ({ isFullScreen: () => true }))).toBe(false);
    trusted.value = true;
  });

  it("tells the renderer when its window enters and leaves full screen", () => {
    const window = fakeWindow();
    watchWindowFullscreen(window);
    window.listeners["enter-full-screen"]();
    window.listeners["leave-full-screen"]();
    expect(window.webContents.send.mock.calls).toEqual([
      [windowFullscreenChangedChannel, true],
      [windowFullscreenChangedChannel, false]
    ]);
    window.destroyed = true;
    window.listeners["enter-full-screen"]();
    expect(window.webContents.send).toHaveBeenCalledTimes(2);
  });

  it("sends menu commands only to the given (focused) window", () => {
    const focused = fakeWindow();
    const other = fakeWindow();
    expect(sendMenuCommand(focused, "toggle-sidebar")).toBe(true);
    expect(focused.webContents.send).toHaveBeenCalledWith(menuCommandChannel, "toggle-sidebar");
    expect(other.webContents.send).not.toHaveBeenCalled();
    expect(sendMenuCommand(null, "toggle-sidebar")).toBe(false);
    focused.destroyed = true;
    expect(sendMenuCommand(focused, "open-settings")).toBe(false);
  });

  it("knows its menu commands", () => {
    expect(isMenuCommand("toggle-sidebar")).toBe(true);
    expect(isMenuCommand("open-settings")).toBe(true);
    expect(isMenuCommand("quit")).toBe(false);
    expect(isMenuCommand(1)).toBe(false);
  });
});
