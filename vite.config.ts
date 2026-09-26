import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
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
