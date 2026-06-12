import { describe, expect, it } from "vitest";
import {
  applyUnifiedDiffStrict,
  convertCodexFileUpdateChangeToDraft
} from "../../electron/agent/runtime/codexPatchConversion";
import { hashMarkdown } from "../../electron/agent/hash";

function updateChange(path: string, diff: string) {
  return {
    path,
    change: {
      kind: { type: "update" },
      unified_diff: diff,
      move_path: null
    }
  };
}

function addChange(path: string, diff: string) {
  return {
    path,
    change: {
      kind: { type: "add" },
      unified_diff: diff,
      move_path: null
    }
  };
}

describe("Codex patch conversion", () => {
  it("converts an add Markdown diff into a create-file draft", () => {
    const diff = [
      "--- /dev/null",
      "+++ b/notes/new.md",
      "@@ -0,0 +1,3 @@",
      "+# New",
      "+",
      "+Body"
    ].join("\n");

    const result = convertCodexFileUpdateChangeToDraft(addChange("notes/new.md", diff));

    expect(result.status).toBe("converted");
    expect(result.draftFileChanges).toHaveLength(1);
    expect(result.draftFileChanges[0]).toMatchObject({
      kind: "create_file",
      relativePath: "notes/new.md",
      content: "# New\n\nBody\n"
    });
    expect(result.draftFileChanges[0]?.unifiedDiff).toContain("--- a/notes/new.md");
  });

  it("handles /dev/null headers for pure adds only", () => {
    const addDiff = ["--- /dev/null", "+++ b/new.md", "@@ -0,0 +1,1 @@", "+New"].join("\n");
    const updateDiff = ["--- /dev/null", "+++ b/new.md", "@@ -0,0 +1,1 @@", "+New"].join("\n");

    expect(convertCodexFileUpdateChangeToDraft(addChange("new.md", addDiff)).status).toBe("converted");
    expect(
      convertCodexFileUpdateChangeToDraft(updateChange("new.md", updateDiff), { baseContent: "" })
    ).toMatchObject({
      status: "error",
      error: expect.stringContaining("cannot use /dev/null")
    });
  });

  it("converts a multi-hunk update into an edit-file draft with base hash and Iliad diff", () => {
    const base = ["# Title", "", "First paragraph.", "", "Second paragraph.", "", "Final line.", ""].join("\n");
    const diff = [
      "--- a/doc.md",
      "+++ b/doc.md",
      "@@ -1,3 +1,3 @@",
      " # Title",
      " ",
      "-First paragraph.",
      "+Updated first paragraph.",
      "@@ -5,3 +5,3 @@",
      " Second paragraph.",
      " ",
      "-Final line.",
      "+Final line with detail."
    ].join("\n");

    const result = convertCodexFileUpdateChangeToDraft(updateChange("doc.md", diff), { baseContent: base });

    expect(result.status).toBe("converted");
    expect(result.draftFileChanges[0]).toMatchObject({
      kind: "edit_file",
      relativePath: "doc.md",
      baseContent: base,
      baseHash: hashMarkdown(base),
      replacement: ["# Title", "", "Updated first paragraph.", "", "Second paragraph.", "", "Final line with detail.", ""].join(
        "\n"
      )
    });
    expect(result.draftFileChanges[0]?.unifiedDiff).toContain("@@ Markdown replacement @@");
  });

  it("preserves base CRLF line endings when applying updates", () => {
    const base = "A\r\nB\r\nC\r\n";
    const diff = ["--- a/doc.md", "+++ b/doc.md", "@@ -1,3 +1,3 @@", " A", "-B", "+Bee", " C"].join("\n");

    const result = convertCodexFileUpdateChangeToDraft(updateChange("doc.md", diff), { baseContent: base });

    expect(result.status).toBe("converted");
    expect(result.draftFileChanges[0]).toMatchObject({
      replacement: "A\r\nBee\r\nC\r\n"
    });
  });

  it("supports no-newline markers", () => {
    const base = "A\nB";
    const diff = [
      "--- a/doc.md",
      "+++ b/doc.md",
      "@@ -1,2 +1,2 @@",
      " A",
      "-B",
      "\\ No newline at end of file",
      "+Bee",
      "\\ No newline at end of file"
    ].join("\n");

    const result = applyUnifiedDiffStrict(base, diff, "doc.md");

    expect(result).toMatchObject({
      status: "converted",
      replacement: "A\nBee"
    });
  });

  it("rejects context mismatches", () => {
    const diff = ["--- a/doc.md", "+++ b/doc.md", "@@ -1,2 +1,2 @@", " A", "-Missing", "+Bee"].join("\n");

    expect(convertCodexFileUpdateChangeToDraft(updateChange("doc.md", diff), { baseContent: "A\nB\n" })).toMatchObject({
      status: "error",
      error: expect.stringContaining("context mismatch")
    });
  });

  it("rejects malformed hunks", () => {
    const diff = ["--- a/doc.md", "+++ b/doc.md", "@@ -1,2 +1,2 @@", " A", "-B"].join("\n");

    expect(convertCodexFileUpdateChangeToDraft(updateChange("doc.md", diff), { baseContent: "A\nB\n" })).toMatchObject({
      status: "error",
      error: expect.stringContaining("does not match header")
    });
  });

  it("rejects path mismatches between event and diff headers", () => {
    const diff = ["--- a/other.md", "+++ b/other.md", "@@ -1 +1 @@", "-Old", "+New"].join("\n");

    expect(convertCodexFileUpdateChangeToDraft(updateChange("doc.md", diff), { baseContent: "Old\n" })).toMatchObject({
      status: "error",
      error: expect.stringContaining("do not match event path")
    });
  });

  it("rejects unsafe or non-Markdown event paths", () => {
    const diff = ["--- a/doc.md", "+++ b/doc.md", "@@ -1 +1 @@", "-Old", "+New"].join("\n");

    for (const unsafePath of ["/tmp/doc.md", "../doc.md", ".hidden.md", "notes/.hidden/doc.md", "doc.txt"]) {
      expect(convertCodexFileUpdateChangeToDraft(updateChange(unsafePath, diff), { baseContent: "Old\n" })).toMatchObject({
        status: "error"
      });
    }
  });

  it("skips delete and rename or move changes", () => {
    const diff = ["--- a/doc.md", "+++ /dev/null", "@@ -1 +0,0 @@", "-Old"].join("\n");

    expect(
      convertCodexFileUpdateChangeToDraft({
        path: "doc.md",
        change: { type: "delete", unified_diff: diff }
      })
    ).toMatchObject({
      status: "skipped",
      notes: [expect.stringContaining("delete")]
    });
    expect(
      convertCodexFileUpdateChangeToDraft({
        path: "doc.md",
        change: { type: "update", move_path: "renamed.md", unified_diff: diff }
      })
    ).toMatchObject({
      status: "skipped",
      notes: [expect.stringContaining("move or rename")]
    });
    expect(
      convertCodexFileUpdateChangeToDraft({
        path: "doc.md",
        change: { kind: { type: "rename" } }
      })
    ).toMatchObject({
      status: "skipped",
      notes: [expect.stringContaining("move or rename")]
    });
  });

  it("rejects add changes when the target already exists", () => {
    const diff = ["--- /dev/null", "+++ b/doc.md", "@@ -0,0 +1,1 @@", "+New"].join("\n");

    expect(convertCodexFileUpdateChangeToDraft(addChange("doc.md", diff), { targetExists: true })).toMatchObject({
      status: "error",
      error: expect.stringContaining("already exists")
    });
  });
});
