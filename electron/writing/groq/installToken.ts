// Anonymous install token for the free route (spec §3, app side). Stored in
// `userData/ai/install.json` `{ token, issuedAt }`, mode 0600. It is a quota
// handle, not a credential protecting anything of the writer's, so it is not
// in the Keychain. No network at construction or launch: the first free
// request issues it (see proxyClient.ts).

import path from "node:path";
import { rm } from "node:fs/promises";
import { readPrivateJson, writePrivateJsonAtomic } from "./privateFile.js";

const MAX_TOKEN_CHARS = 4096;

/** Opaque, but it must be a single printable ASCII word of bounded length. */
export function isPlausibleInstallToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_TOKEN_CHARS && /^[\x21-\x7e]+$/.test(value);
}

export function installTokenPath(userDataPath: string) {
  return path.join(userDataPath, "ai", "install.json");
}

export class InstallTokenStore {
  private readonly filePath: string;
  private cached: string | null | undefined;

  constructor(userDataPath: string, private readonly now: () => number = Date.now) {
    this.filePath = installTokenPath(userDataPath);
  }

  /** The saved token, or null when missing or corrupt (the caller re-issues). */
  async read(): Promise<string | null> {
    if (this.cached !== undefined) return this.cached;
    const stored = await readPrivateJson(this.filePath);
    this.cached = stored.kind === "ok" && isPlausibleInstallToken(stored.value.token) ? stored.value.token : null;
    return this.cached;
  }

  async write(token: string): Promise<void> {
    await writePrivateJsonAtomic(this.filePath, { token, issuedAt: new Date(this.now()).toISOString() });
    this.cached = token;
  }

  async clear(): Promise<void> {
    this.cached = null;
    await rm(this.filePath, { force: true });
  }
}
