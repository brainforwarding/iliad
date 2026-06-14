import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { insertPlainProseNewline } from "../../src/editor/proseEnter";

function runCommand(doc: string, cursor = doc.length) {
  let state = EditorState.create({
    doc,
    selection: { anchor: cursor }
  });
  const handled = insertPlainProseNewline({
    state,
    dispatch(transaction) {
      state = transaction.state;
    }
  });

  return { handled, doc: state.doc.toString(), cursor: state.selection.main.from };
}

describe("prose Enter behavior", () => {
  it("inserts a plain newline in prose without carrying accidental indentation", () => {
    const result = runCommand(" This prose line has a stray leading space.");

    expect(result.handled).toBe(true);
    expect(result.doc).toBe(" This prose line has a stray leading space.\n");
    expect(result.cursor).toBe(result.doc.length);
  });

  it("lets Markdown list and blockquote continuation handle structured lines", () => {
    expect(runCommand("- list item").handled).toBe(false);
    expect(runCommand("> quote").handled).toBe(false);
    expect(runCommand("    code").handled).toBe(false);
  });

  it("does not override fenced code blocks", () => {
    const doc = "```ts\nconst value = 1";

    expect(runCommand(doc).handled).toBe(false);
  });
});
