import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const defaultAppName = "Iliad MD.app";

function defaultFs() {
  return {
    exists: (target) => existsSync(target),
    isDirectory: (target) => {
      try {
        return statSync(target).isDirectory();
      } catch {
        return false;
      }
    },
    listDirectory: (target) => {
      try {
        return readdirSync(target);
      } catch {
        return [];
      }
    }
  };
}

/**
 * The executable inside a macOS `.app` bundle. When the CLI already runs as
 * that executable (the packaged wrapper sets ELECTRON_RUN_AS_NODE), reuse it;
 * otherwise take the single entry of `Contents/MacOS`.
 */
function bundleExecutable(appPath, { execPath, fs }) {
  const macosDirectory = path.join(appPath, "Contents", "MacOS");

  if (execPath && path.dirname(execPath) === macosDirectory) {
    return execPath;
  }

  const productExecutable = path.join(macosDirectory, path.basename(appPath, ".app"));

  if (fs.exists(productExecutable)) {
    return productExecutable;
  }

  const [first] = fs.listDirectory(macosDirectory).filter((name) => !name.startsWith("."));
  return first ? path.join(macosDirectory, first) : null;
}

function appLauncher(appPath, source, options) {
  const command = bundleExecutable(appPath, options);
  return command ? { kind: "app", source, command, prefixArgs: [], appPath } : null;
}

/**
 * Picks how to start the GUI app, by where this script lives (spec V24):
 * `ILIAD_APP` overrides; a script inside `X.app/Contents/Resources/bin`
 * launches that app; a script in a checkout with `node_modules/.bin/electron`
 * launches the checkout; otherwise the installed app in /Applications.
 */
export function resolveLauncher({
  scriptDirectory,
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
  execPath = process.execPath,
  fs = defaultFs()
}) {
  const options = { execPath, fs };

  if (env.ILIAD_APP) {
    const override = path.resolve(env.ILIAD_APP);

    if (override.endsWith(".app") && fs.isDirectory(override)) {
      const launcher = appLauncher(override, "ILIAD_APP", options);

      if (launcher) {
        return launcher;
      }
    } else if (fs.exists(override) && !fs.isDirectory(override)) {
      return { kind: "app", source: "ILIAD_APP", command: override, prefixArgs: [], appPath: override };
    }

    throw new Error(`ILIAD_APP does not point to an Iliad app: ${override}`);
  }

  const bundleMatch = /^(.*\.app)[\\/]Contents[\\/]Resources[\\/]bin$/.exec(scriptDirectory);

  if (bundleMatch) {
    const launcher = appLauncher(bundleMatch[1], "bundle", options);

    if (launcher) {
      return launcher;
    }
  }

  const checkoutRoot = path.resolve(scriptDirectory, "..");
  const electronExecutable = path.join(
    checkoutRoot,
    "node_modules",
    ".bin",
    platform === "win32" ? "electron.cmd" : "electron"
  );

  if (fs.exists(electronExecutable)) {
    return { kind: "checkout", source: "checkout", command: electronExecutable, prefixArgs: [checkoutRoot], appPath: checkoutRoot };
  }

  if (platform === "darwin") {
    for (const candidate of [path.join("/Applications", defaultAppName), path.join(home, "Applications", defaultAppName)]) {
      if (fs.isDirectory(candidate)) {
        const launcher = appLauncher(candidate, "installed", options);

        if (launcher) {
          return launcher;
        }
      }
    }
  }

  throw new Error(
    "Could not find the Iliad app. Install Iliad MD, run `npm install` in the Iliad checkout, or set ILIAD_APP."
  );
}

/**
 * The GUI app must never inherit ELECTRON_RUN_AS_NODE from the packaged CLI
 * wrapper, or it would start as a plain Node process.
 */
export function guiEnvironment(env = process.env) {
  const next = { ...env };
  delete next.ELECTRON_RUN_AS_NODE;
  return next;
}

export function launchApp(launcher, args, { cwd = process.cwd(), env = process.env, spawnProcess = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(launcher.command, [...launcher.prefixArgs, ...args], {
      cwd,
      detached: true,
      env: guiEnvironment(env),
      stdio: "ignore",
      windowsHide: true
    });
    let settled = false;

    child.once("error", (error) => {
      if (!settled) {
        settled = true;
        reject(new Error(`Could not start Iliad: ${error.message}`));
      }
    });
    child.once("spawn", () => {
      if (!settled) {
        settled = true;
        child.unref();
        resolve();
      }
    });
  });
}
