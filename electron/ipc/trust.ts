import { BrowserWindow } from "electron";
import type { IpcMainInvokeEvent } from "electron";

export type TrustedIpcEvent = Pick<IpcMainInvokeEvent, "sender" | "senderFrame">;

/**
 * Privileged IPC (writing AI, review actions, corrector memory) is accepted
 * only from an Iliad window showing the app itself: the packaged `file:` page,
 * or the dev server origin in development.
 */
export function isTrustedIpcSender(event: TrustedIpcEvent) {
  if (!BrowserWindow.fromWebContents(event.sender)) {
    return false;
  }

  return isTrustedSenderFrameUrl(event.senderFrame?.url ?? "", process.env.VITE_DEV_SERVER_URL);
}

export function isTrustedSenderFrameUrl(frameUrl: string, devServerUrl: string | undefined) {
  const parsedFrameUrl = parseUrl(frameUrl);

  if (!parsedFrameUrl) {
    return false;
  }

  if (!devServerUrl) {
    return parsedFrameUrl.protocol === "file:";
  }

  const parsedDevServerUrl = parseUrl(devServerUrl);
  return Boolean(parsedDevServerUrl && parsedFrameUrl.origin === parsedDevServerUrl.origin);
}

function parseUrl(url: string) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}
