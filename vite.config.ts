import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build identity stamped into the renderer at build/dev-server start. The
// package version alone cannot answer "is this the current build?" for local
// `iliad .` launches, so the workspace menu shows version + commit + date.
function gitShortHash() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const packageVersion = (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string })
  .version;

export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageVersion),
    __APP_BUILD_HASH__: JSON.stringify(gitShortHash()),
    __APP_BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10))
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  server: {
    host: "127.0.0.1",
    port: 5173
  }
});
