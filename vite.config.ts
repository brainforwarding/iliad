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
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/**"]
  }
});
