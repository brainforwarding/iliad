export const TELEGRAM_REMOTE_REQUEST_VERSION = 1;
export const TELEGRAM_REMOTE_MAX_TEXT_LENGTH = 2_000;
export const TELEGRAM_REMOTE_THREAD_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/;

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

export interface RemoteWorkspaceContext {
  root: string;
  label?: string;
}

export interface RemotePairedTelegramChat {
  chatId: string;
  username?: string;
  displayName?: string;
  pairedAt: string;
}

export interface TelegramRemotePairingStartResponse {
  token: string;
  pairingSessionId: string;
  expiresAt: string;
  pairingUrl?: string;
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

export interface TelegramRemoteErrorSummary {
  message: string;
  at: string;
}

export interface TelegramRemoteSettings {
  enabled: boolean;
  relayDeviceId: string;
  deviceSecret: string;
  pairedChat: RemotePairedTelegramChat | null;
  lastConnectedAt?: string;
  lastError?: TelegramRemoteErrorSummary | null;
  boundWorkspaceRoot?: string;
  activeThreadId?: string;
  activeThreadWorkspaceRoot?: string;
  updatedAt: string;
}

export interface TelegramRemoteSettingsUpdate {
  enabled?: boolean;
  relayDeviceId?: string;
  deviceSecret?: string;
  pairedChat?: RemotePairedTelegramChat | null;
  lastConnectedAt?: string | null;
  lastError?: TelegramRemoteErrorSummary | null;
  boundWorkspaceRoot?: string | null;
  activeThreadId?: string | null;
  activeThreadWorkspaceRoot?: string | null;
}
