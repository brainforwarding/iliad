import { ipcMain } from "electron";
import { GROQ_API_KEY_MAX_CHARS } from "../writing/groq/config.js";
import { GROQ_MODEL } from "../writing/groq/prompts/index.js";
import type { SetGroqKeyResult, WritingAiService, WritingAssistStatus } from "../writing/writingAiService.js";
import { isTrustedIpcSender, type TrustedIpcEvent } from "./trust.js";

type WritingSettingsService = Pick<WritingAiService, "writingAssistStatus" | "getGroqKeyState" | "setGroqApiKey" | "warmConnection">;

const untrustedStatus: WritingAssistStatus = {
  corrector: { available: false, provider: null },
  ai: { route: "blocked", model: GROQ_MODEL },
  groqKey: { state: "none", last4: null, rejected: false }
};

export function registerWritingSettingsIpc({ service }: { service: WritingSettingsService }) {
  ipcMain.handle("writing-assist:status", (event) => handleWritingAssistStatusIpc(event, service));
  ipcMain.handle("writing:get-groq-key-state", (event) => handleGetGroqKeyStateIpc(event, service));
  ipcMain.handle("writing:set-groq-key", (event, key: unknown) => handleSetGroqKeyIpc(event, key, service));
  ipcMain.handle("writing:set-recording-shortcut", (event, recording: unknown) => handleSetRecordingShortcutIpc(event, recording));
  ipcMain.handle("writing-ai:warm", (event) => handleWarmWritingAiIpc(event, service));
}

/**
 * The writer is back in the editor with AI on: keep the connection to the
 * active endpoint warm (rate-limited and route-aware in the service; no
 * request body, no quota). Fire and forget: never fails the renderer.
 */
export async function handleWarmWritingAiIpc(event: TrustedIpcEvent, service: Pick<WritingSettingsService, "warmConnection">) {
  if (!isTrustedIpcSender(event)) return;
  await service.warmConnection().catch(() => undefined);
}

/**
 * While a Writing assists key chip records a shortcut, the app menu's own
 * shortcuts (Quit, Copy, Hide…) must not act on the keys being pressed
 * (spec 2026-09-27). Scoped to the sender's window.
 */
export function handleSetRecordingShortcutIpc(event: TrustedIpcEvent, recording: unknown) {
  if (!isTrustedIpcSender(event) || typeof recording !== "boolean") return;
  event.sender.setIgnoreMenuShortcuts(recording);
}

export function handleWritingAssistStatusIpc(event: TrustedIpcEvent, service: WritingSettingsService) {
  return isTrustedIpcSender(event) ? service.writingAssistStatus() : untrustedStatus;
}

export function handleGetGroqKeyStateIpc(event: TrustedIpcEvent, service: WritingSettingsService) {
  return isTrustedIpcSender(event) ? service.getGroqKeyState() : untrustedStatus.groqKey;
}

/**
 * Saves (string) or removes (null) the own Groq key. A new key is validated
 * against Groq in main first and saved only on a 200 (spec §6).
 */
export async function handleSetGroqKeyIpc(
  event: TrustedIpcEvent,
  key: unknown,
  service: WritingSettingsService
): Promise<SetGroqKeyResult> {
  if (!isTrustedIpcSender(event)) {
    throw new Error("The key request came from an untrusted window.");
  }

  if (key === null) {
    return service.setGroqApiKey(null);
  }

  if (typeof key !== "string") {
    return { ok: false, reason: "invalid_shape" };
  }

  const trimmed = key.trim();

  if (!trimmed || trimmed.length > GROQ_API_KEY_MAX_CHARS || /\s/.test(trimmed)) {
    return { ok: false, reason: "invalid_shape" };
  }

  return service.setGroqApiKey(trimmed);
}
