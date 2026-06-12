#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const binDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(binDirectory, "..");
const electronExecutable = path.join(
  appRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron.cmd" : "electron"
);

if (!existsSync(electronExecutable)) {
  console.error("Iliad CLI could not find the local Electron binary. Run `npm install` in the Iliad project first.");
  process.exit(1);
}

const child = spawn(electronExecutable, [appRoot, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  detached: true,
  stdio: "ignore",
  windowsHide: true
});

child.on("error", (error) => {
  console.error(`Iliad CLI could not start Electron: ${error.message}`);
  process.exit(1);
});

child.unref();
