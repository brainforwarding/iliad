import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The prompt module is imported by the Iliad AI proxy Worker, whose tsconfig
// has Node types, so typechecking alone would not catch a Node/Electron/DOM
// dependency. Walk the import graph from prompts/index.ts instead (spec §2).

const PROMPTS_DIR = path.resolve(__dirname, "../../../electron/writing/groq/prompts");
const ENTRY = path.join(PROMPTS_DIR, "index.ts");

// Globals that exist only in a browser, Node or Electron — not in a Worker's
// plain JS runtime, and not needed to build a prompt.
const FORBIDDEN_GLOBALS = [
  "window", "document", "navigator", "localStorage", "sessionStorage", "HTMLElement",
  "process", "require", "Buffer", "__dirname", "__filename", "global", "globalThis",
  "fetch", "TextEncoder", "TextDecoder", "crypto", "setTimeout", "setInterval", "console", "Date"
];

function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

function stripStrings(source: string) {
  return source.replace(/`(?:\\[\s\S]|\$\{[^}]*\}|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, '""');
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) specifiers.push(match[1] ?? match[2] ?? match[3]);
  return specifiers;
}

function walk(entry: string) {
  const seen = new Set<string>();
  const problems: string[] = [];
  const queue = [entry];

  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = stripComments(fs.readFileSync(file, "utf8"));

    for (const specifier of importSpecifiers(source)) {
      if (!specifier.startsWith(".")) {
        problems.push(`${path.basename(file)} imports non-relative "${specifier}"`);
        continue;
      }
      const resolved = path.resolve(path.dirname(file), specifier.replace(/\.js$/, ".ts"));
      if (!resolved.startsWith(`${PROMPTS_DIR}${path.sep}`)) {
        problems.push(`${path.basename(file)} imports outside prompts/: "${specifier}"`);
        continue;
      }
      queue.push(resolved);
    }

    const code = stripStrings(source);
    for (const name of FORBIDDEN_GLOBALS) {
      if (new RegExp(`(?<![\\w.$])${name}\\b(?!\\s*:)`).test(code)) {
        problems.push(`${path.basename(file)} uses the global "${name}"`);
      }
    }
  }

  return { files: [...seen].map((file) => path.relative(PROMPTS_DIR, file)).sort(), problems };
}

describe("prompts/ purity", () => {
  it("imports nothing outside prompts/ and uses no Node, Electron or DOM globals", () => {
    const { files, problems } = walk(ENTRY);
    expect(files).toEqual(["index.ts", "limits.ts", "v1.ts"]);
    expect(problems).toEqual([]);
  });

  it("covers every file in prompts/", () => {
    const onDisk = fs.readdirSync(PROMPTS_DIR).filter((name) => name.endsWith(".ts")).sort();
    expect(walk(ENTRY).files).toEqual(onDisk);
  });

  it("would catch a forbidden import (self-check of the walker)", () => {
    expect(importSpecifiers('import fs from "node:fs";\nexport { x } from "./a.js";\nimport type { Y } from "electron";')).toEqual([
      "node:fs",
      "./a.js",
      "electron"
    ]);
  });
});
