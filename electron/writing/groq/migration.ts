// Startup migration off Gemini (spec §6, G4). Awaited in main before the
// writing IPC handlers are registered, so no status call or request can see
// the old state. Idempotent; a failure is reported by code and retried next
// launch, never blocking the app.
//
// `userData/assistant/settings.json` (historical location, plain JSON) is
// rewritten without `geminiApiKey`, keeping other historical fields, via an
// atomic write + chmod 0600; if nothing remains the file is deleted.

import { chmod, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { readPrivateJson, writePrivateJsonAtomic } from "./privateFile.js";

export function legacyWritingSettingsPath(userDataPath: string) {
  return path.join(userDataPath, "assistant", "settings.json");
}

export type LegacyMigrationResult =
  | { ok: true; outcome: "absent" | "unchanged" | "rewritten" | "deleted" }
  | { ok: false; errorCode: string };

export async function migrateLegacyWritingSettings(userDataPath: string): Promise<LegacyMigrationResult> {
  const filePath = legacyWritingSettingsPath(userDataPath);

  try {
    const stored = await readPrivateJson(filePath);

    if (stored.kind === "missing") return { ok: true, outcome: "absent" };

    if (stored.kind === "corrupt") {
      // Unparsable: its fields cannot be preserved. Delete it only if it may hold a Gemini key.
      const raw = await readFile(filePath, "utf8").catch(() => "");
      if (raw.includes("geminiApiKey")) {
        await rm(filePath, { force: true });
        return { ok: true, outcome: "deleted" };
      }
      await chmod(filePath, 0o600);
      return { ok: true, outcome: "unchanged" };
    }

    if (!Object.prototype.hasOwnProperty.call(stored.value, "geminiApiKey")) {
      await chmod(filePath, 0o600);
      return { ok: true, outcome: "unchanged" };
    }

    const rest = { ...stored.value };
    delete rest.geminiApiKey;

    if (Object.keys(rest).length === 0) {
      await rm(filePath, { force: true });
      return { ok: true, outcome: "deleted" };
    }

    await writePrivateJsonAtomic(filePath, rest);
    return { ok: true, outcome: "rewritten" };
  } catch (error) {
    const code = typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string"
      ? String((error as { code: string }).code).slice(0, 32)
      : "unknown";
    return { ok: false, errorCode: code };
  }
}
