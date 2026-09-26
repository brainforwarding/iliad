// Private app-data files for writing AI (`userData/ai/*.json`, and the legacy
// `userData/assistant/settings.json` migration). Spec §6: every write is a
// temp file + rename in the same directory, then an explicit chmod 0600
// (`writeFile(…, { mode })` does not fix the mode of an existing file).

import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

export async function writePrivateFileAtomic(filePath: string, contents: string): Promise<void> {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${randomBytes(6).toString("hex")}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | null = null;

  try {
    handle = await open(tempPath, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await chmod(tempPath, 0o600);
    await rename(tempPath, filePath);
    await chmod(filePath, 0o600);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writePrivateJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writePrivateFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export type PrivateJsonRead =
  | { kind: "missing" }
  | { kind: "corrupt" }
  | { kind: "ok"; value: Record<string, unknown> };

/** Reads a JSON object file. Parse errors are never rethrown (their messages quote the input). */
export async function readPrivateJson(filePath: string): Promise<PrivateJsonRead> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    return isMissing(error) ? { kind: "missing" } : { kind: "corrupt" };
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { kind: "ok", value: parsed as Record<string, unknown> }
      : { kind: "corrupt" };
  } catch {
    return { kind: "corrupt" };
  }
}

function isMissing(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT";
}
