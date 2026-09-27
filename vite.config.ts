import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    // Settings → General shows it; the same version main reports via app.getVersion().
    __ILIAD_VERSION__: JSON.stringify(packageJson.version)
  },
  optimizeDeps: {
    exclude: ["harper.js", "harper.js/binary"]
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  server: {
    host: "127.0.0.1",
    port: 5173
  },
  test: {
    // Agent worktrees live under .claude/; never run their copies of the suite.
    // The AI proxy's workerd integration tests import `cloudflare:test` and run
    // only under their own pool: `npm run proxy:test:workers`.
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/**", "relay/ai-proxy/tests/workers/**"]
  }
});
