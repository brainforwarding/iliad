import { execFile } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The install logic lives once, in `bin/lib/install.mjs` (the CLI's
 * `iliad install`). The packaged app ships `bin/` as an extra resource, so the
 * menu item "Install ‘iliad’ Command…" loads that same module from
 * `Contents/Resources/bin/lib/install.mjs` instead of keeping a copy here.
 */

export interface InstallCommandResult {
  action: "installed" | "unchanged";
  linkPath: string;
  directory: string;
  target: string;
  onPath: boolean;
  shadowedBy: string | null;
}

/** The parts of `bin/lib/install.mjs` the menu uses. */
export interface InstallModule {
  commandInstallDirectories(home?: string): string[];
  bundleWrapperPath(scriptDirectory: string): Promise<string>;
  installCliCommand(options: {
    wrapperPath: string;
    directories: string[];
    pathValue: string;
    createMissingDirectory: string | null;
  }): Promise<InstallCommandResult>;
}

export function installModulePath(resourcesPath: string) {
  return path.join(resourcesPath, "bin", "lib", "install.mjs");
}

export async function loadInstallModule(resourcesPath: string): Promise<InstallModule> {
  const loaded = (await import(pathToFileURL(installModulePath(resourcesPath)).href)) as Partial<InstallModule>;

  if (
    typeof loaded.installCliCommand !== "function" ||
    typeof loaded.bundleWrapperPath !== "function" ||
    typeof loaded.commandInstallDirectories !== "function"
  ) {
    throw new Error("The bundled install script is incomplete. Reinstall Iliad MD.");
  }

  return loaded as InstallModule;
}

/**
 * Installs the command for the app whose Resources folder is `resourcesPath`,
 * with the same rules as `iliad install`.
 */
export async function installCommandFromResources({
  resourcesPath,
  home,
  pathValue
}: {
  resourcesPath: string;
  home: string;
  pathValue: string;
}) {
  const install = await loadInstallModule(resourcesPath);
  const wrapperPath = await install.bundleWrapperPath(path.join(resourcesPath, "bin"));
  return install.installCliCommand({
    wrapperPath,
    directories: install.commandInstallDirectories(home),
    pathValue,
    createMissingDirectory: path.join(home, ".local", "bin")
  });
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
