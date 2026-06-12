export const TELEGRAM_REMOTE_REQUEST_VERSION = 1;
export const TELEGRAM_REMOTE_MAX_TEXT_LENGTH = 2_000;
export const TELEGRAM_PAIRING_TOKEN_TTL_MS = 10 * 60 * 1000;
export const TELEGRAM_REMOTE_REQUEST_TIMEOUT_MS = 60 * 1000;
export const TELEGRAM_CHUNK_MAX_LENGTH = 3_900;

export interface RemoteBaseRequest {
  version: typeof TELEGRAM_REMOTE_REQUEST_VERSION;
  id: string;
  chatId: string;
  createdAt: string;
  deadlineAt: string;
}

export interface RemoteStatusRequest extends RemoteBaseRequest {
  type: "status";
}

export interface RemoteAskRequest extends RemoteBaseRequest {
  type: "ask";
  text: string;
}

export type RemoteRequest = RemoteStatusRequest | RemoteAskRequest;

export interface RemoteAnswerSource {
  relativePath: string;
  line?: number;
}

export type RemoteErrorCode =
  | "desktop_offline"
  | "not_paired"
  | "remote_disabled"
  | "workspace_unavailable"
  | "empty_question"
  | "question_too_long"
  | "busy"
  | "deadline_exceeded"
  | "rate_limited"
  | "agent_unavailable"
  | "unknown";

export type RemoteResponse =
  | {
      version: typeof TELEGRAM_REMOTE_REQUEST_VERSION;
      id: string;
      ok: true;
      type: "status";
      desktopOnline: true;
      workspaceLabel: string;
      remoteChatEnabled: true;
    }
  | {
      version: typeof TELEGRAM_REMOTE_REQUEST_VERSION;
      id: string;
      ok: true;
      type: "answer";
      text: string;
      sources: RemoteAnswerSource[];
      manifestId?: string;
    }
  | {
      version: typeof TELEGRAM_REMOTE_REQUEST_VERSION;
      id: string;
      ok: false;
      error: {
        code: RemoteErrorCode;
        message: string;
      };
    };

export interface RemotePairedTelegramChat {
  chatId: string;
  username?: string;
  displayName?: string;
  pairedAt: string;
}

export type RelayToDesktopMessage =
  | { type: "remote_request"; request: RemoteRequest }
  | {
      type: "pairing_completed";
      pairingSessionId: string;
      chat: RemotePairedTelegramChat;
      expiresAt: string;
    }
  | { type: "pairing_revoked" }
  | { type: "ping" };

export type DesktopToRelayMessage =
  | { type: "desktop_auth"; deviceId: string; deviceSecret: string }
  | { type: "remote_response"; id: string; response: RemoteResponse }
  | { type: "pong" };

export interface PairingStartRequest {
  deviceId: string;
  deviceSecret: string;
}

export interface PairingStartResponse {
  token: string;
  pairingSessionId: string;
  expiresAt: string;
  pairingUrl?: string;
}

export interface PairingRevokeRequest {
  deviceId: string;
  deviceSecret: string;
}

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id?: number;
  date?: number;
  text?: string;
  chat: TelegramChat;
  from?: TelegramUser;
}

export interface TelegramChat {
  id: number | string;
  type: "private" | "group" | "supergroup" | "channel" | string;
  username?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
}

export interface TelegramUser {
  id?: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDesktopAuthMessage(value: unknown): value is Extract<DesktopToRelayMessage, { type: "desktop_auth" }> {
  return (
    isRecord(value) &&
    value.type === "desktop_auth" &&
    typeof value.deviceId === "string" &&
    typeof value.deviceSecret === "string"
  );
}

export function isDesktopRelayMessage(value: unknown): value is DesktopToRelayMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  if (value.type === "pong") {
    return true;
  }

  if (value.type === "desktop_auth") {
    return isDesktopAuthMessage(value);
  }

  if (value.type !== "remote_response" || typeof value.id !== "string") {
    return false;
  }

  return isRemoteResponse(value.response);
}

export function isRemoteResponse(value: unknown): value is RemoteResponse {
  if (!isRecord(value) || value.version !== TELEGRAM_REMOTE_REQUEST_VERSION || typeof value.id !== "string") {
    return false;
  }

  if (value.ok === false) {
    return (
      isRecord(value.error) &&
      typeof value.error.code === "string" &&
      typeof value.error.message === "string" &&
      value.error.message.trim().length > 0
    );
  }

  if (value.ok !== true || typeof value.type !== "string") {
    return false;
  }

  if (value.type === "status") {
    return value.desktopOnline === true && value.remoteChatEnabled === true && typeof value.workspaceLabel === "string";
  }

  if (value.type === "answer") {
    return typeof value.text === "string" && Array.isArray(value.sources) && value.sources.every(isRemoteAnswerSource);
  }

  return false;
}

function isRemoteAnswerSource(value: unknown): value is RemoteAnswerSource {
  return (
    isRecord(value) &&
    typeof value.relativePath === "string" &&
    (value.line === undefined || (typeof value.line === "number" && Number.isFinite(value.line)))
  );
}
