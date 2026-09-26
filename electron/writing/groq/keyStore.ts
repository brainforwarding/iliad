// The writer's own Groq key (spec §6). Stored in `userData/ai/settings.json`,
// encrypted with Electron `safeStorage` (Keychain-backed on macOS) as base64
// `groqApiKeyEnc`; plaintext is never written unless encryption is
// unavailable (then `groqApiKey` with `storage: "plain"`, mode 0600).
//
// Three states: `none` → free route; `ok` → own-key route; `unreadable` (a
// saved key that cannot be decrypted, or a corrupt file) → AI blocked until
// the writer re-enters or removes it. Unreadable is never treated as "none".

import path from "node:path";
import { rm } from "node:fs/promises";
import { DEV_GROQ_KEY_ENV } from "./config.js";
import { readPrivateJson, writePrivateJsonAtomic } from "./privateFile.js";

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export type GroqKeyStateName = "none" | "ok" | "unreadable";

export interface GroqKeyState {
  state: GroqKeyStateName;
  /** Last four characters of the key in use, for display only. */
  last4: string | null;
}

export type GroqKeyRead =
  | { state: "none" }
  | { state: "ok"; key: string }
  | { state: "unreadable" };

interface StoredAiSettings {
  groqApiKeyEnc?: string;
  groqApiKey?: string;
  storage?: "safeStorage" | "plain";
  [key: string]: unknown;
}

export interface GroqKeyStoreOptions {
  safeStorage?: SafeStorageLike | null;
  /** Dev only: read `GROQ_API_KEY` when no key is saved. False in packaged builds. */
  allowEnvKey?: boolean;
  env?: NodeJS.ProcessEnv;
}

export function aiSettingsPath(userDataPath: string) {
  return path.join(userDataPath, "ai", "settings.json");
}

export class GroqKeyStore {
  private readonly filePath: string;
  private readonly safeStorage: SafeStorageLike | null;
  private readonly allowEnvKey: boolean;
  private readonly env: NodeJS.ProcessEnv;
  private cached: GroqKeyRead | null = null;

  constructor(userDataPath: string, options: GroqKeyStoreOptions = {}) {
    this.filePath = aiSettingsPath(userDataPath);
    this.safeStorage = options.safeStorage ?? null;
    this.allowEnvKey = options.allowEnvKey ?? false;
    this.env = options.env ?? process.env;
  }

  async read(): Promise<GroqKeyRead> {
    if (this.cached) return this.cached;
    const read = await this.readFromDisk();
    this.cached = read;
    return read;
  }

  async getState(): Promise<GroqKeyState> {
    const read = await this.read();
    return read.state === "ok"
      ? { state: "ok", last4: read.key.slice(-4) }
      : { state: read.state, last4: null };
  }

  /** Saves (string) or removes (null) the key. Validation against Groq happens before this. */
  async setKey(key: string | null): Promise<GroqKeyState> {
    this.cached = null;
    const trimmed = typeof key === "string" ? key.trim() : "";
    const current = await readPrivateJson(this.filePath);
    const rest: StoredAiSettings = current.kind === "ok" ? { ...current.value } : {};
    delete rest.groqApiKeyEnc;
    delete rest.groqApiKey;
    delete rest.storage;

    if (!trimmed) {
      if (Object.keys(rest).length === 0) {
        await rm(this.filePath, { force: true });
      } else {
        await writePrivateJsonAtomic(this.filePath, rest);
      }
      return this.getState();
    }

    const next: StoredAiSettings = this.safeStorage?.isEncryptionAvailable()
      ? { ...rest, storage: "safeStorage", groqApiKeyEnc: this.safeStorage.encryptString(trimmed).toString("base64") }
      : { ...rest, storage: "plain", groqApiKey: trimmed };
    await writePrivateJsonAtomic(this.filePath, next);
    return this.getState();
  }

  private async readFromDisk(): Promise<GroqKeyRead> {
    const stored = await readPrivateJson(this.filePath);

    if (stored.kind === "corrupt") return { state: "unreadable" };

    if (stored.kind === "ok") {
      const settings = stored.value as StoredAiSettings;

      if (settings.groqApiKeyEnc !== undefined) {
        if (typeof settings.groqApiKeyEnc !== "string" || !this.safeStorage?.isEncryptionAvailable()) {
          return { state: "unreadable" };
        }
        try {
          const key = this.safeStorage.decryptString(Buffer.from(settings.groqApiKeyEnc, "base64")).trim();
          return key ? { state: "ok", key } : { state: "unreadable" };
        } catch {
          return { state: "unreadable" };
        }
      }

      if (settings.groqApiKey !== undefined) {
        return typeof settings.groqApiKey === "string" && settings.groqApiKey.trim()
          ? { state: "ok", key: settings.groqApiKey.trim() }
          : { state: "unreadable" };
      }
    }

    const envKey = this.allowEnvKey ? this.env[DEV_GROQ_KEY_ENV]?.trim() : "";
    return envKey ? { state: "ok", key: envKey } : { state: "none" };
  }
}
