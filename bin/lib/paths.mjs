import os from "node:os";
import endpoint from "./endpoint.cjs";
import path from "node:path";

export const packagedUserDataName = "Iliad MD";
export const devUserDataName = "iliad-dev";
export const socketFileName = "iliad.sock";

/**
 * Mirrors Electron's `app.getPath("appData")` for the current platform.
 */
export function appDataDirectory({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  if (platform === "darwin") {
    return paths.join(home, "Library", "Application Support");
  }

  if (platform === "win32") {
    return env.APPDATA || paths.join(home, "AppData", "Roaming");
  }

  return env.XDG_CONFIG_HOME || paths.join(home, ".config");
}

/**
 * The app's userData folder, which holds the CLI socket. Mirrors
 * electron/main.ts exactly: `ILIAD_USER_DATA` overrides, dev runs
 * (`VITE_DEV_SERVER_URL` set) use `iliad-dev`, everything else (packaged
 * app and checkout launches) uses `Iliad MD`.
 */
export function userDataDirectory(options = {}) {
  const env = options.env ?? process.env;
  const paths = (options.platform ?? process.platform) === "win32" ? path.win32 : path.posix;

  if (env.ILIAD_USER_DATA) {
    return paths.resolve(env.ILIAD_USER_DATA);
  }

  const name = env.VITE_DEV_SERVER_URL ? devUserDataName : packagedUserDataName;
  return paths.join(appDataDirectory(options), name);
}

export function cliSocketPath(options = {}) {
  return endpoint.cliEndpoint(userDataDirectory(options), options.platform ?? process.platform);
}

export function abbreviateHome(absolutePath, home = os.homedir()) {
  if (!home) {
    return absolutePath;
  }

  if (absolutePath === home) {
    return "~";
  }

  const separator = home.includes("\\") ? "\\" : "/";
  const prefix = home.endsWith(separator) ? home : `${home}${separator}`;
  return absolutePath.startsWith(prefix) ? `~${separator}${absolutePath.slice(prefix.length)}` : absolutePath;
}
