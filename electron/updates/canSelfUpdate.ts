import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";

export type SelfUpdateBlocker =
  | "not-packaged"
  | "not-macos"
  | "not-app-bundle"
  | "translocated"
  | "read-only-volume"
  | "folder-not-writable";

export type SelfUpdateSupport = { ok: true; appPath: string } | { ok: false; reason: SelfUpdateBlocker };

export interface CanSelfUpdateOptions {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  /** `process.execPath`: …/Iliad MD.app/Contents/MacOS/Iliad MD */
  executablePath: string;
  resolve?: (target: string) => Promise<string>;
  /** The error code of a write-access probe (EROFS on a read-only volume), or null. */
  probeWrite?: (target: string) => Promise<string | null>;
  isDirectory?: (target: string) => Promise<boolean>;
}

async function realpathOrSelf(target: string) {
  try {
    return await realpath(target);
  } catch {
    return path.resolve(target);
  }
}

async function writeProbe(target: string) {
  try {
    await access(target, constants.W_OK);
    return null;
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code ?? "EACCES";
  }
}

async function directoryExists(target: string) {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Whether Squirrel.Mac can replace this copy in place. Same checks as
 * `bin/lib/install.mjs` (`bundleWrapperPath`) on the resolved bundle path —
 * App Translocation and read-only volumes (a mounted DMG) — plus a writable
 * parent folder, since the new bundle is moved in next to the old one.
 * Quarantine alone is not a reason.
 */
export async function canSelfUpdate({
  isPackaged,
  platform,
  executablePath,
  resolve = realpathOrSelf,
  probeWrite = writeProbe,
  isDirectory = directoryExists
}: CanSelfUpdateOptions): Promise<SelfUpdateSupport> {
  if (!isPackaged) {
    return { ok: false, reason: "not-packaged" };
  }

  if (platform !== "darwin") {
    return { ok: false, reason: "not-macos" };
  }

  const resolved = await resolve(executablePath);
  const match = /^(.*?\.app)\/Contents\/MacOS\/[^/]+$/.exec(resolved);

  if (!match) {
    return { ok: false, reason: "not-app-bundle" };
  }

  const appPath = match[1];

  if (appPath.split("/").includes("AppTranslocation")) {
    return { ok: false, reason: "translocated" };
  }

  if ((await probeWrite(appPath)) === "EROFS") {
    return { ok: false, reason: "read-only-volume" };
  }

  const parent = path.dirname(appPath);

  if (!(await isDirectory(parent)) || (await probeWrite(parent)) !== null) {
    return { ok: false, reason: "folder-not-writable" };
  }

  return { ok: true, appPath };
}
