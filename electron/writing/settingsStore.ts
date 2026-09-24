import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// The file keeps its historical location so keys saved by earlier versions keep
// working. Fields written by earlier versions (OpenAI key, model, mode) are
// ignored but preserved on write.
interface StoredSettings {
  geminiApiKey?: string;
  [key: string]: unknown;
}

export interface GeminiKeyState {
  hasKey: boolean;
  /** Last four characters of the key in use, for display only. */
  last4: string | null;
}

function settingsPath(userDataPath: string) {
  return path.join(userDataPath, "assistant", "settings.json");
}

async function readStoredSettings(userDataPath: string): Promise<StoredSettings> {
  try {
    const parsed = JSON.parse(await readFile(settingsPath(userDataPath), "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as StoredSettings) : {};
  } catch {
    return {};
  }
}

async function writeStoredSettings(userDataPath: string, settings: StoredSettings) {
  const filePath = settingsPath(userDataPath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export class WritingSettingsStore {
  constructor(private readonly userDataPath: string) {}

  async getGeminiApiKey() {
    const settings = await readStoredSettings(this.userDataPath);
    const stored = typeof settings.geminiApiKey === "string" ? settings.geminiApiKey.trim() : "";
    return stored || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  }

  async getGeminiKeyState(): Promise<GeminiKeyState> {
    const key = await this.getGeminiApiKey();
    return key ? { hasKey: true, last4: key.slice(-4) } : { hasKey: false, last4: null };
  }

  async setGeminiApiKey(key: string | null): Promise<GeminiKeyState> {
    const current = await readStoredSettings(this.userDataPath);
    const trimmed = typeof key === "string" ? key.trim() : "";
    const next: StoredSettings = { ...current };

    if (trimmed) {
      next.geminiApiKey = trimmed;
    } else {
      delete next.geminiApiKey;
    }

    await writeStoredSettings(this.userDataPath, next);
    return this.getGeminiKeyState();
  }
}
