import { createRequire } from "node:module";
import type { UpdaterLike } from "./appUpdater.js";

const require = createRequire(import.meta.url);

/**
 * electron-updater's platform updater (MacUpdater, Squirrel.Mac underneath),
 * reading the GitHub provider from the packaged `app-update.yml`. Loaded
 * lazily and only when this copy can update itself — never in development,
 * and never on the launch path.
 */
export function createAppUpdater(): UpdaterLike {
  const { autoUpdater } = require("electron-updater") as typeof import("electron-updater");
  return autoUpdater as unknown as UpdaterLike;
}
