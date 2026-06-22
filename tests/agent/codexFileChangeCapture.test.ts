import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureMarkdownSnapshot,
  convertAndReconcileCodexFileChanges
} from "../../electron/agent/runtime/codexFileChangeCapture";
import type { AgentRunRequest } from "../../electron/agent/types";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

function runRequest(workspaceRoot: string): AgentRunRequest {
  return {
    runId: "run-codex-capture-test",
    workspaceRoot,
    activeFile: null,
    messages: [],
    prompt: "Delete the file.",
    mode: "balanced",
    language: "en"
  };
}

describe("Codex file change capture", () => {
  it("turns disk Markdown deletions into reviewable delete drafts and restores the file", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "iliad-codex-capture-"));
    tempDirs.push(workspaceRoot);
    const filePath = path.join(workspaceRoot, "delete-me.md");
    await writeFile(filePath, "# Delete Me\n\nOriginal text.\n", "utf8");

    const snapshot = await captureMarkdownSnapshot(runRequest(workspaceRoot));
    await rm(filePath);
    const unsupportedNotes = new Set<string>();
    const result = await convertAndReconcileCodexFileChanges({
      snapshot,
      fileChanges: new Map(),
      unsupportedNotes
    });

    expect(result.draftFileChanges).toEqual([
      expect.objectContaining({
        kind: "delete_file",
        relativePath: "delete-me.md",
        baseContent: "# Delete Me\n\nOriginal text.\n",
        unifiedDiff: expect.stringContaining("--- a/delete-me.md")
      })
    ]);
    expect(result.sourceCounts.disk).toBe(1);
    expect(result.unsupportedNotes).toEqual([]);
    expect(await readFile(filePath, "utf8")).toBe("# Delete Me\n\nOriginal text.\n");
  });

  it("does not show unsupported Codex delete notes when disk reconciliation recovers the delete", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "iliad-codex-capture-"));
    tempDirs.push(workspaceRoot);
    const filePath = path.join(workspaceRoot, "delete-me.md");
    await writeFile(filePath, "# Delete Me\n\nOriginal text.\n", "utf8");

    const snapshot = await captureMarkdownSnapshot(runRequest(workspaceRoot));
    await rm(filePath);
    const unsupportedNotes = new Set<string>();
    const result = await convertAndReconcileCodexFileChanges({
      snapshot,
      fileChanges: new Map([
        [
          "delete-me.md",
          [
            {
              path: "delete-me.md",
              kind: { type: "delete" },
              diff: ""
            }
          ]
        ]
      ]),
      unsupportedNotes
    });

    expect(result.draftFileChanges).toEqual([
      expect.objectContaining({
        kind: "delete_file",
        relativePath: "delete-me.md"
      })
    ]);
    expect(result.sourceCounts.skipped).toBe(1);
    expect(result.unsupportedNotes).toEqual([]);
    expect(await readFile(filePath, "utf8")).toBe("# Delete Me\n\nOriginal text.\n");
  });
});
