import { constants, existsSync } from "node:fs";
import { access, lstat, mkdir, readlink, realpath, rename, rm, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installWindowsCommand, uninstallWindowsCommand, windowsCommandDirectory } from "./windowsInstall.mjs";

/**
 * Putting `iliad` on PATH (macOS app bundles). The single implementation
 * behind both `iliad install` / `iliad uninstall` and the app menu item
 * "Install ‘iliad’ Command…" (electron/cli/installCommand.ts loads this file
 * from the app's Resources folder).
 */

export const commandName = "iliad";
export const homebrewCaskToken = "iliad-md";

/**
 * A refusal with a stable `code` for `--json` callers:
 * not-app-bundle, disk-image, no-folder, folder-unusable, slot-taken.
 */
export class InstallError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

export function commandInstallDirectories(home = os.homedir()) {
  if (process.platform === "win32") return [windowsCommandDirectory(process.env, home)];
  return ["/opt/homebrew/bin", "/usr/local/bin", path.join(home, ".local", "bin")];
}

// The wrapper of an Iliad app bundle ("Iliad MD.app", a renamed copy like
// "Iliad MD 2.app", an old "Old Iliad.app"), not any app's bin/iliad.
const iliadWrapperPattern = /\/[^/]*Iliad[^/]*\.app\/Contents\/Resources\/bin\/iliad$/;

/**
 * True for a link to an Iliad wrapper: this one, or the `iliad` wrapper of any
 * (possibly moved or deleted) Iliad app bundle.
 */
export function isIliadWrapperTarget(linkTarget, linkDirectory, wrapperPath) {
  const resolved = path.resolve(linkDirectory, linkTarget);
  return (
    (wrapperPath !== undefined && wrapperPath !== null && resolved === path.resolve(wrapperPath)) ||
    iliadWrapperPattern.test(resolved)
  );
}

export function directoryIsOnPath(directory, pathValue = "") {
  const target = path.resolve(directory);
  return pathValue
    .split(path.delimiter)
    .filter(Boolean)
    .some((entry) => path.resolve(entry) === target);
}

async function isExecutableFile(candidate) {
  try {
    const stats = await stat(candidate);
    await access(candidate, constants.X_OK);
    return stats.isFile();
  } catch {
    return false;
  }
}

/** The first executable `iliad` a shell with this PATH would run, or null. */
export async function firstOnPath(pathValue = "", name = commandName) {
  for (const entry of pathValue.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(path.resolve(entry), name);

    if (await isExecutableFile(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function realpathOrSelf(target) {
  try {
    return await realpath(target);
  } catch {
    return path.resolve(target);
  }
}

async function isWritableDirectory(directory) {
  try {
    const stats = await stat(directory);
    await access(directory, constants.W_OK);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/** The error code of a write-access probe (EROFS on a read-only volume), or null. */
async function writeProbe(target) {
  try {
    await access(target, constants.W_OK);
    return null;
  } catch (error) {
    return error?.code ?? "EACCES";
  }
}

/**
 * The packaged wrapper next to the running CLI script, or an InstallError.
 * Refuses checkouts (no .app bundle) and bundles that would leave a dangling
 * link: App Translocation, and any read-only volume (a mounted DMG, wherever
 * it is mounted). A bundle the user merely cannot write (installed by another
 * admin) is fine.
 */
export async function bundleWrapperPath(scriptDirectory, { exists = existsSync, probe = writeProbe, resolve = realpathOrSelf } = {}) {
  const directory = scriptDirectory ? await resolve(scriptDirectory) : "";
  if (process.platform === "win32" && exists(path.resolve(directory, "..", "..", "Iliad MD.exe")) && exists(path.join(directory, "iliad.cmd"))) {
    return path.join(directory, "iliad.cmd");
  }
  const match = /^(.*\.app)[\\/]Contents[\\/]Resources[\\/]bin$/.exec(directory);

  if (!match || !exists(path.join(directory, commandName))) {
    throw new InstallError(
      "iliad install works from the Iliad MD app. In a checkout, run `npm link` instead.",
      "not-app-bundle"
    );
  }

  const appPath = match[1];

  if (appPath.split(path.sep).includes("AppTranslocation") || (await probe(appPath)) === "EROFS") {
    throw new InstallError(
      `Iliad MD is running from a disk image or a quarantined location (${appPath}). Copy it to /Applications first.`,
      "disk-image"
    );
  }

  return path.join(directory, commandName);
}

/**
 * What is in `<directory>/iliad`: nothing, our link (to this wrapper), another
 * Iliad link (old, moved or deleted bundle), or something else that must
 * never be replaced.
 */
async function inspectSlot(linkPath, wrapperPath) {
  let stats;

  try {
    stats = await lstat(linkPath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { kind: "empty" };
    }

    throw error;
  }

  if (!stats.isSymbolicLink()) {
    return { kind: "foreign" };
  }

  const target = await readlink(linkPath);
  const directory = path.dirname(linkPath);

  if (wrapperPath && path.resolve(directory, target) === path.resolve(wrapperPath)) {
    return { kind: "ours", target };
  }

  return { kind: isIliadWrapperTarget(target, directory, wrapperPath) ? "iliad" : "foreign", target };
}

/**
 * Puts the link in place without ever replacing something that is not an
 * Iliad link: an empty slot is filled with a plain symlink (fails with EEXIST
 * if anything appeared meanwhile); an old Iliad link is re-read just before an
 * atomic temp-link + rename.
 */
async function placeLink(linkPath, wrapperPath, slot) {
  if (slot.kind === "empty") {
    try {
      await symlink(wrapperPath, linkPath);
      return true;
    } catch (error) {
      if (error?.code === "EEXIST") {
        return false;
      }

      throw error;
    }
  }

  const temporary = path.join(
    path.dirname(linkPath),
    `.${commandName}-install-${process.pid}-${Math.random().toString(36).slice(2)}`
  );

  await symlink(wrapperPath, temporary);

  try {
    const current = await inspectSlot(linkPath, wrapperPath);

    if (current.kind !== "iliad" || current.target !== slot.target) {
      await rm(temporary, { force: true });
      return false;
    }

    await rename(temporary, linkPath);
    return true;
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/**
 * Symlinks the packaged `iliad` wrapper into the first usable folder (writable,
 * `iliad` slot empty or an Iliad link). `~/.local/bin` (createMissingDirectory)
 * is created when needed. With `exactDirectory`, only that folder is tried and
 * each refusal is an error.
 */
export async function installCliCommand({
  wrapperPath,
  directories,
  exactDirectory = null,
  pathValue = "",
  createMissingDirectory = null
}) {
  if (process.platform === "win32") return installWindowsCommand({ wrapperPath, directory: exactDirectory ?? directories[0], pathValue });
  const candidates = exactDirectory ? [path.resolve(exactDirectory)] : directories;

  for (const directory of candidates) {
    if (!exactDirectory && directory === createMissingDirectory) {
      await mkdir(directory, { recursive: true }).catch(() => undefined);
    }

    if (!(await isWritableDirectory(directory))) {
      if (exactDirectory) {
        throw new InstallError(`Cannot install into ${directory}: it is not a writable folder.`, "folder-unusable");
      }

      continue;
    }

    const linkPath = path.join(directory, commandName);
    const slot = await inspectSlot(linkPath, wrapperPath);
    const placed = slot.kind === "ours" || (slot.kind !== "foreign" && (await placeLink(linkPath, wrapperPath, slot)));

    if (!placed) {
      if (exactDirectory) {
        throw new InstallError(`Cannot install into ${directory}: ${linkPath} is another program's \`iliad\`.`, "slot-taken");
      }

      continue;
    }

    const first = await firstOnPath(pathValue);
    const shadowedBy =
      first && first !== linkPath && (await realpathOrSelf(first)) !== (await realpathOrSelf(wrapperPath)) ? first : null;

    return {
      action: slot.kind === "ours" ? "unchanged" : "installed",
      linkPath,
      directory,
      target: wrapperPath,
      onPath: directoryIsOnPath(directory, pathValue),
      shadowedBy
    };
  }

  throw new InstallError(`No writable folder for the command. Tried: ${candidates.join(", ")}.`, "no-folder");
}

/** Homebrew links casks' binaries into `<prefix>/bin`; the cask lives in `<prefix>/Caskroom`. */
export function homebrewOwnsDirectory(directory, exists = existsSync) {
  return exists(path.join(path.dirname(path.resolve(directory)), "Caskroom", homebrewCaskToken));
}

/**
 * Removes `iliad` links that point to an Iliad wrapper from the given folders.
 * Never touches real files, links to other programs, or Homebrew's link.
 */
export async function uninstallCliCommand({ directories, exists = existsSync }) {
  if (process.platform === "win32") return uninstallWindowsCommand({ directories });
  const removed = [];
  const skipped = [];

  for (const directory of directories) {
    const linkPath = path.join(directory, commandName);
    let slot;

    try {
      slot = await inspectSlot(linkPath, null);
    } catch {
      continue;
    }

    if (slot.kind !== "iliad") {
      continue;
    }

    if (homebrewOwnsDirectory(directory, exists)) {
      skipped.push({ linkPath, reason: `Installed by Homebrew; run \`brew uninstall --cask ${homebrewCaskToken}\`.` });
      continue;
    }

    try {
      await rm(linkPath);
      removed.push(linkPath);
    } catch (error) {
      skipped.push({ linkPath, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { removed, skipped };
}
