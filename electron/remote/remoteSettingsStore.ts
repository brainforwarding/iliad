import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  RemotePairedTelegramChat,
  TelegramRemoteErrorSummary,
  TelegramRemoteSettings,
  TelegramRemoteSettingsUpdate
} from "./remoteTypes.js";
import { TELEGRAM_REMOTE_THREAD_ID_PATTERN } from "./remoteTypes.js";

function remoteSettingsPath(userDataPath: string) {
  return path.join(userDataPath, "remote", "telegram.json");
}

function defaultSettings(): TelegramRemoteSettings {
  return {
    enabled: false,
    relayDeviceId: "",
    deviceSecret: "",
    pairedChat: null,
    updatedAt: ""
  };
}

async function readStoredSettings(userDataPath: string): Promise<Partial<TelegramRemoteSettings>> {
  try {
    return JSON.parse(await readFile(remoteSettingsPath(userDataPath), "utf8")) as Partial<TelegramRemoteSettings>;
  } catch {
    return {};
  }
}

async function writeStoredSettings(userDataPath: string, settings: TelegramRemoteSettings) {
  const filePath = remoteSettingsPath(userDataPath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export class RemoteSettingsStore {
  constructor(private readonly userDataPath: string) {}

  async snapshot(): Promise<TelegramRemoteSettings> {
    return sanitizeSettings(await readStoredSettings(this.userDataPath));
  }

  async update(update: TelegramRemoteSettingsUpdate): Promise<TelegramRemoteSettings> {
    const current = await this.snapshot();
    const next: TelegramRemoteSettings = {
      ...current,
      updatedAt: new Date().toISOString()
    };

    if (typeof update.enabled === "boolean") {
      next.enabled = update.enabled;
    }

    if (typeof update.relayDeviceId === "string") {
      next.relayDeviceId = update.relayDeviceId.trim();
    }

    if (typeof update.deviceSecret === "string") {
      next.deviceSecret = update.deviceSecret.trim();
    }

    if (update.pairedChat !== undefined) {
      next.pairedChat = update.pairedChat ? sanitizePairedChat(update.pairedChat) : null;
    }

    if (update.lastConnectedAt !== undefined) {
      if (typeof update.lastConnectedAt === "string" && update.lastConnectedAt.trim()) {
        next.lastConnectedAt = update.lastConnectedAt.trim();
      } else {
        delete next.lastConnectedAt;
      }
    }

    if (update.lastError !== undefined) {
      next.lastError = update.lastError ? sanitizeErrorSummary(update.lastError) : null;
    }

    if (update.boundWorkspaceRoot !== undefined) {
      const previousBoundWorkspaceRoot = next.boundWorkspaceRoot;
      if (typeof update.boundWorkspaceRoot === "string" && update.boundWorkspaceRoot.trim()) {
        next.boundWorkspaceRoot = path.resolve(update.boundWorkspaceRoot.trim());
      } else {
        delete next.boundWorkspaceRoot;
      }

      if (
        previousBoundWorkspaceRoot &&
        next.boundWorkspaceRoot &&
        path.resolve(previousBoundWorkspaceRoot) !== path.resolve(next.boundWorkspaceRoot)
      ) {
        delete next.activeThreadId;
        delete next.activeThreadWorkspaceRoot;
      }
    }

    if (update.activeThreadId !== undefined) {
      const activeThreadId = sanitizeThreadId(update.activeThreadId);
      const activeThreadWorkspaceRoot =
        typeof update.activeThreadWorkspaceRoot === "string" && update.activeThreadWorkspaceRoot.trim()
          ? path.resolve(update.activeThreadWorkspaceRoot.trim())
          : next.boundWorkspaceRoot;

      if (activeThreadId && activeThreadWorkspaceRoot) {
        next.activeThreadId = activeThreadId;
        next.activeThreadWorkspaceRoot = activeThreadWorkspaceRoot;
      } else {
        delete next.activeThreadId;
        delete next.activeThreadWorkspaceRoot;
      }
    } else if (update.activeThreadWorkspaceRoot !== undefined) {
      if (typeof update.activeThreadWorkspaceRoot === "string" && update.activeThreadWorkspaceRoot.trim() && next.activeThreadId) {
        next.activeThreadWorkspaceRoot = path.resolve(update.activeThreadWorkspaceRoot.trim());
      } else {
        delete next.activeThreadId;
        delete next.activeThreadWorkspaceRoot;
      }
    }

    if (next.enabled) {
      next.relayDeviceId = next.relayDeviceId || randomUUID();
      next.deviceSecret = next.deviceSecret || randomBytes(32).toString("base64url");
    }

    if (
      next.activeThreadId &&
      (!next.activeThreadWorkspaceRoot ||
        (next.boundWorkspaceRoot && path.resolve(next.activeThreadWorkspaceRoot) !== path.resolve(next.boundWorkspaceRoot)))
    ) {
      delete next.activeThreadId;
      delete next.activeThreadWorkspaceRoot;
    }

    await writeStoredSettings(this.userDataPath, next);
    return next;
  }

  async ensureDeviceCredentials(): Promise<TelegramRemoteSettings> {
    const current = await this.snapshot();

    if (current.relayDeviceId && current.deviceSecret) {
      return current;
    }

    return this.update({
      relayDeviceId: current.relayDeviceId || randomUUID(),
      deviceSecret: current.deviceSecret || randomBytes(32).toString("base64url")
    });
  }

  pairChat(chat: RemotePairedTelegramChat) {
    return this.update({ pairedChat: chat });
  }

  revokePairing() {
    return this.update({ pairedChat: null });
  }
}

function sanitizeSettings(source: Partial<TelegramRemoteSettings>): TelegramRemoteSettings {
  const boundWorkspaceRoot =
    typeof source.boundWorkspaceRoot === "string" && source.boundWorkspaceRoot.trim()
      ? path.resolve(source.boundWorkspaceRoot.trim())
      : "";

  return {
    ...defaultSettings(),
    enabled: Boolean(source.enabled),
    relayDeviceId: typeof source.relayDeviceId === "string" ? source.relayDeviceId.trim() : "",
    deviceSecret: typeof source.deviceSecret === "string" ? source.deviceSecret.trim() : "",
    pairedChat: source.pairedChat ? sanitizePairedChat(source.pairedChat) : null,
    ...(typeof source.lastConnectedAt === "string" && source.lastConnectedAt.trim()
      ? { lastConnectedAt: source.lastConnectedAt.trim() }
      : {}),
    ...(source.lastError ? { lastError: sanitizeErrorSummary(source.lastError) } : {}),
    ...(boundWorkspaceRoot ? { boundWorkspaceRoot } : {}),
    ...sanitizeActiveThread(source, boundWorkspaceRoot),
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : ""
  };
}

function sanitizeActiveThread(source: Partial<TelegramRemoteSettings>, boundWorkspaceRoot: string) {
  const activeThreadId = sanitizeThreadId(source.activeThreadId);
  const activeThreadWorkspaceRoot =
    typeof source.activeThreadWorkspaceRoot === "string" && source.activeThreadWorkspaceRoot.trim()
      ? path.resolve(source.activeThreadWorkspaceRoot.trim())
      : "";

  if (
    activeThreadWorkspaceRoot &&
    boundWorkspaceRoot &&
    path.resolve(activeThreadWorkspaceRoot) !== path.resolve(boundWorkspaceRoot)
  ) {
    return {};
  }

  return activeThreadId && activeThreadWorkspaceRoot
    ? { activeThreadId, activeThreadWorkspaceRoot }
    : {};
}

function sanitizeThreadId(value: unknown) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return TELEGRAM_REMOTE_THREAD_ID_PATTERN.test(trimmed) ? trimmed : "";
}

function sanitizePairedChat(source: RemotePairedTelegramChat): RemotePairedTelegramChat {
  return {
    chatId: stringValue(source.chatId),
    ...(source.username ? { username: stringValue(source.username) } : {}),
    ...(source.displayName ? { displayName: stringValue(source.displayName) } : {}),
    pairedAt: stringValue(source.pairedAt) || new Date().toISOString()
  };
}

function sanitizeErrorSummary(source: TelegramRemoteErrorSummary): TelegramRemoteErrorSummary {
  return {
    message: stringValue(source.message),
    at: stringValue(source.at) || new Date().toISOString()
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
