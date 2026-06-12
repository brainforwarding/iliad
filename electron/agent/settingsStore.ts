import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultAgentModel, normalizeAgentModel } from "./agentModels.js";
import { OPENAI_RESPONSES_PROVIDER_METADATA } from "./runtime/openaiResponsesProvider.js";
import type { AgentMode, AgentSettingsSnapshot, AgentSettingsUpdate } from "./types.js";

interface StoredSettings {
  openAiApiKey?: string;
  model?: string;
  mode?: AgentMode;
}

const defaultMode: AgentMode = "balanced";

function settingsPath(userDataPath: string) {
  return path.join(userDataPath, "assistant", "settings.json");
}

async function readStoredSettings(userDataPath: string): Promise<StoredSettings> {
  try {
    return JSON.parse(await readFile(settingsPath(userDataPath), "utf8")) as StoredSettings;
  } catch {
    return {};
  }
}

async function writeStoredSettings(userDataPath: string, settings: StoredSettings) {
  const filePath = settingsPath(userDataPath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export class AgentSettingsStore {
  constructor(private readonly userDataPath: string) {}

  async snapshot(): Promise<AgentSettingsSnapshot> {
    const settings = await readStoredSettings(this.userDataPath);

    return {
      hasOpenAiApiKey: Boolean(settings.openAiApiKey || process.env.OPENAI_API_KEY),
      model: normalizeAgentModel(settings.model),
      mode: settings.mode || defaultMode,
      runtimeProvider: OPENAI_RESPONSES_PROVIDER_METADATA
    };
  }

  async getApiKey() {
    const settings = await readStoredSettings(this.userDataPath);
    return settings.openAiApiKey || process.env.OPENAI_API_KEY || "";
  }

  async update(update: AgentSettingsUpdate): Promise<AgentSettingsSnapshot> {
    const current = await readStoredSettings(this.userDataPath);
    const next: StoredSettings = {
      ...current,
      model: normalizeAgentModel(update.model ?? current.model ?? defaultAgentModel),
      mode: update.mode || current.mode || defaultMode
    };

    if (typeof update.openAiApiKey === "string") {
      const trimmedKey = update.openAiApiKey.trim();
      if (trimmedKey) {
        next.openAiApiKey = trimmedKey;
      }
    }

    await writeStoredSettings(this.userDataPath, next);
    return this.snapshot();
  }
}
