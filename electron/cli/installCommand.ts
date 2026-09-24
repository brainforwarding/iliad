import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, mkdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface InstallCommandResult {
  linkPath: string;
  directory: string;
  onPath: boolean;
}

export function commandInstallDirectories(home = os.homedir()) {
  return ["/opt/homebrew/bin", "/usr/local/bin", path.join(home, ".local", "bin")];
}

async function isWritableDirectory(directory: string) {
  try {
    await access(directory, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** A symlink (ours or stale) may be replaced; a real file is never overwritten. */
async function linkSlotIsFree(linkPath: string) {
  try {
    const stats = await lstat(linkPath);
    return stats.isSymbolicLink();
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

export function directoryIsOnPath(directory: string, pathValue: string) {
  const target = path.resolve(directory);
  return pathValue
    .split(path.delimiter)
    .filter(Boolean)
    .some((entry) => path.resolve(entry) === target);
}

/**
 * Symlinks the packaged `iliad` wrapper into the first writable of
 * /opt/homebrew/bin, /usr/local/bin, ~/.local/bin (created if missing).
 */
export async function installCliCommand({
  wrapperPath,
  directories = commandInstallDirectories(),
  pathValue,
  createMissingDirectory = path.join(os.homedir(), ".local", "bin")
}: {
  wrapperPath: string;
  directories?: string[];
  pathValue: string;
  createMissingDirectory?: string | null;
}): Promise<InstallCommandResult> {
  for (const directory of directories) {
    if (directory === createMissingDirectory) {
      await mkdir(directory, { recursive: true }).catch(() => undefined);
    }

    if (!(await isWritableDirectory(directory))) {
      continue;
    }

    const linkPath = path.join(directory, "iliad");

    if (!(await linkSlotIsFree(linkPath))) {
      continue;
    }

    await rm(linkPath, { force: true });
    await symlink(wrapperPath, linkPath);
    return { linkPath, directory, onPath: directoryIsOnPath(directory, pathValue) };
  }

  throw new Error(`No writable folder for the command. Tried: ${directories.join(", ")}.`);
}

/**
 * GUI apps on macOS get a minimal PATH; ask the user's login shell for the
 * PATH their terminal sees. Falls back to the app's own PATH.
 */
export function loginShellPath(fallback = process.env.PATH ?? ""): Promise<string> {
  const shell = process.env.SHELL || "/bin/zsh";

  return new Promise((resolve) => {
    // Interactive + login so both profile and rc files run; markers skip any
    // greeting those files print.
    execFile(shell, ["-i", "-l", "-c", 'printf "__ILIAD_PATH__%s__ILIAD_END__" "$PATH"'], { timeout: 5000 }, (_error, stdout) => {
      const match = /__ILIAD_PATH__(.*?)__ILIAD_END__/s.exec(stdout ?? "");
      resolve(match?.[1]?.trim() ? match[1].trim() : fallback);
    });
  });
}
