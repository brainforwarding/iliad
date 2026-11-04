import { history, redo, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, type StateCommand } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { toggleBold, toggleItalics } from "../../src/editor/inlineFormatting";
import { collectInlineStyles } from "../../src/editor/inlineStyles";

function editor(doc: string, anchor: number, head = anchor, readOnly = false) {
  const target = {
    state: EditorState.create({ doc, selection: { anchor, head }, extensions: [history(), EditorState.readOnly.of(readOnly)] }),
    dispatch(transaction: { state: EditorState }) { target.state = transaction.state; }
  };
  return target;
}

describe("inline formatting commands", () => {
  for (const [name, command, marker] of [["bold", toggleBold, "**"], ["italics", toggleItalics, "*"]] as const) {
    it(`${name}: wraps selected text and keeps it selected`, () => {
      const target = editor("a word here", 2, 6);
      command(target);
      expect(target.state.doc.toString()).toBe(`a ${marker}word${marker} here`);
      expect(target.state.sliceDoc(target.state.selection.main.from, target.state.selection.main.to)).toBe("word");
      command(target);
      expect(target.state.doc.toString()).toBe("a word here");
      expect(target.state.selection.main).toMatchObject({ anchor: 2, head: 6 });
    });

    it(`${name}: inserts and removes an empty marker pair`, () => {
      const target = editor("hello ", 6);
      command(target);
      expect(target.state.doc.toString()).toBe(`hello ${marker}${marker}`);
      expect(target.state.selection.main.head).toBe(6 + marker.length);
      command(target);
      expect(target.state.doc.toString()).toBe("hello ");
      expect(target.state.selection.main.head).toBe(6);
    });

    it(`${name}: removes enclosing formatting at a caret or partial selection`, () => {
      for (const [anchor, head] of [[marker.length + 1, marker.length + 1], [marker.length + 3, marker.length + 1]]) {
        const target = editor(`${marker}word${marker}`, anchor, head);
        command(target);
        expect(target.state.doc.toString()).toBe("word");
        expect(target.state.selection.main).toMatchObject({ anchor: anchor - marker.length, head: head - marker.length });
      }
    });

    it(`${name}: removes selected markers too`, () => {
      const target = editor(`${marker}word${marker}`, 0, 4 + marker.length * 2);
      command(target);
      expect(target.state.doc.toString()).toBe("word");
      expect(target.state.selection.main).toMatchObject({ anchor: 0, head: 4 });
    });
  }

  it("preserves backward selections and leaves surrounding whitespace outside markers", () => {
    const target = editor("one two ", 8, 3);
    toggleBold(target);
    expect(target.state.doc.toString()).toBe("one **two** ");
    expect(target.state.selection.main.anchor).toBeGreaterThan(target.state.selection.main.head);
  });

  it("preserves paragraphs and Markdown prefixes in a multiline selection", () => {
    const doc = "# Title\n\n- one\n> two\n- [ ] task\nplain text";
    const target = editor(doc, 0, doc.length);
    toggleBold(target);
    expect(target.state.doc.toString()).toBe("# **Title**\n\n- **one**\n> **two**\n- [ ] **task**\n**plain text**");
    toggleBold(target);
    expect(target.state.doc.toString()).toBe(doc);
  });

  it("keeps optional closing heading hashes outside formatting", () => {
    const target = editor("### Title ###", 0, 13);
    toggleBold(target);
    expect(target.state.doc.toString()).toBe("### **Title** ###");
    toggleBold(target);
    expect(target.state.doc.toString()).toBe("### Title ###");
  });

  it("can start formatting immediately after inline code", () => {
    const target = editor("`code`", 6);
    toggleBold(target);
    expect(target.state.doc.toString()).toBe("`code`****");
    expect(target.state.selection.main.head).toBe(8);
  });

  it("toggles bold and italics independently on the same selected text", () => {
    const target = editor("word", 0, 4);
    toggleBold(target);
    toggleItalics(target);
    expect(target.state.doc.toString()).toBe("***word***");
    expect(collectInlineStyles(target.state.doc.toString())).toMatchObject({ strong: [{ contentFrom: 3, contentTo: 7 }], emphasis: [{ from: 0, to: 10 }] });
    toggleBold(target);
    expect(target.state.doc.toString()).toBe("*word*");
    toggleItalics(target);
    expect(target.state.doc.toString()).toBe("word");
  });

  it("removes italics from combined formatting without removing bold", () => {
    const target = editor("***word***", 3, 7);
    toggleItalics(target);
    expect(target.state.doc.toString()).toBe("**word**");
    expect(target.state.selection.main).toMatchObject({ anchor: 2, head: 6 });
  });

  it("toggles a style when the selection includes combined markers or surrounding spaces", () => {
    for (const command of [toggleBold, toggleItalics]) {
      const target = editor(" ***word*** ", 0, 12);
      command(target);
      expect(target.state.doc.toString()).toBe(command === toggleBold ? " *word* " : " **word** ");
    }
  });

  it("does not modify read-only documents, code, or selections crossing code", () => {
    const cases: Array<[string, number, number, boolean?]> = [
      ["word", 0, 4, true], ["`word`", 2, 2], ["before `code` after", 0, 19],
      ["```md\nword\n```", 6, 10], ["    code", 4, 8]
    ];
    for (const [doc, anchor, head, readOnly] of cases) {
      const target = editor(doc, anchor, Math.min(head, doc.length), readOnly);
      expect(toggleBold(target)).toBe(true);
      expect(target.state.doc.toString()).toBe(doc);
      expect(toggleItalics(target)).toBe(true);
      expect(target.state.doc.toString()).toBe(doc);
    }
  });

  it("formats a mixed selection without duplicating existing markers", () => {
    const doc = "**bold** and plain";
    const target = editor(doc, 0, doc.length);
    toggleBold(target);
    expect(target.state.doc.toString()).toBe("**bold and plain**");
  });

  it("leaves partially selected cross-line emphasis unchanged", () => {
    const doc = "**hello\nworld** and rest";
    const target = editor(doc, 0, doc.length);
    toggleBold(target);
    expect(target.state.doc.toString()).toBe(doc);
  });

  it("undoes and redoes formatting as one step without losing the original selection", () => {
    const target = editor("word", 0, 4);
    toggleBold(target);
    (undo as StateCommand)(target);
    expect(target.state.doc.toString()).toBe("word");
    expect(target.state.selection.main).toMatchObject({ anchor: 0, head: 4 });
    (redo as StateCommand)(target);
    expect(target.state.doc.toString()).toBe("**word**");
  });
});
