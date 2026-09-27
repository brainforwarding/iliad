import { BrowserWindow, ipcMain } from "electron";
import { isTrustedIpcSender, type TrustedIpcEvent } from "./trust.js";

/** Main → renderer: the window entered (true) or left (false) full screen. */
export const windowFullscreenChangedChannel = "window:fullscreen-changed";
/** Main → renderer: an app-menu command meant for this window. */
export const menuCommandChannel = "window:menu-command";

/** Commands the app menu sends to the window it was used in (View → Toggle Sidebar, App → Settings…). */
export const menuCommands = ["toggle-sidebar", "open-settings"] as const;
export type MenuCommand = (typeof menuCommands)[number];

export function isMenuCommand(value: unknown): value is MenuCommand {
  return typeof value === "string" && (menuCommands as readonly string[]).includes(value);
}

type FullscreenWindow = Pick<BrowserWindow, "isFullScreen">;

export function registerWindowIpc({
  windowForEvent = (event: TrustedIpcEvent) => BrowserWindow.fromWebContents(event.sender)
}: { windowForEvent?: (event: TrustedIpcEvent) => FullscreenWindow | null } = {}) {
  ipcMain.handle("window:is-fullscreen", (event) => handleIsFullscreenIpc(event, windowForEvent));
}

/** The initial full-screen state of the sender's window; false for anything untrusted. */
export function handleIsFullscreenIpc(
  event: TrustedIpcEvent,
  windowForEvent: (event: TrustedIpcEvent) => FullscreenWindow | null
) {
  if (!isTrustedIpcSender(event)) {
    return false;
  }

  return Boolean(windowForEvent(event)?.isFullScreen());
}

interface WatchedWindow {
  on(event: "enter-full-screen", listener: () => void): unknown;
  on(event: "leave-full-screen", listener: () => void): unknown;
  isDestroyed(): boolean;
  webContents: { send: (channel: string, ...args: unknown[]) => void };
}

/** Tells the window's renderer every time it enters or leaves full screen. */
export function watchWindowFullscreen(window: WatchedWindow) {
  const notify = (fullscreen: boolean) => {
    if (!window.isDestroyed()) {
      window.webContents.send(windowFullscreenChangedChannel, fullscreen);
    }
  };

  window.on("enter-full-screen", () => notify(true));
  window.on("leave-full-screen", () => notify(false));
}

/**
 * Sends a menu command to the window the menu was used in (Electron passes the
 * focused window to the click handler), never to "the most recent" window.
 */
export function sendMenuCommand(window: Pick<WatchedWindow, "isDestroyed" | "webContents"> | null | undefined, command: MenuCommand) {
  if (!window || window.isDestroyed()) {
    return false;
  }

  window.webContents.send(menuCommandChannel, command);
  return true;
}
