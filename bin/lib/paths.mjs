import os from "node:os";
import path from "node:path";

export const packagedUserDataName = "Iliad MD";
export const devUserDataName = "iliad-dev";
export const socketFileName = "iliad.sock";

/**
 * Mirrors Electron's `app.getPath("appData")` for the current platform.
 */
export function appDataDirectory({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support");
  }

  if (platform === "win32") {
    return env.APPDATA || path.join(home, "AppData", "Roaming");
  }

  return env.XDG_CONFIG_HOME || path.join(home, ".config");
}

/**
 * The app's userData folder, which holds the CLI socket. Mirrors
 * electron/main.ts exactly: `ILIAD_USER_DATA` overrides, dev runs
 * (`VITE_DEV_SERVER_URL` set) use `iliad-dev`, everything else (packaged
 * app and checkout launches) uses `Iliad MD`.
 */
export function userDataDirectory(options = {}) {
  const env = options.env ?? process.env;

  if (env.ILIAD_USER_DATA) {
    return path.resolve(env.ILIAD_USER_DATA);
  }

  const name = env.VITE_DEV_SERVER_URL ? devUserDataName : packagedUserDataName;
  return path.join(appDataDirectory(options), name);
}

export function cliSocketPath(options = {}) {
  return path.join(userDataDirectory(options), socketFileName);
}

export function abbreviateHome(absolutePath, home = os.homedir()) {
  if (!home) {
    return absolutePath;
  }

  if (absolutePath === home) {
    return "~";
  }

  const prefix = home.endsWith(path.sep) ? home : `${home}${path.sep}`;
  return absolutePath.startsWith(prefix) ? `~${path.sep}${absolutePath.slice(prefix.length)}` : absolutePath;
}
