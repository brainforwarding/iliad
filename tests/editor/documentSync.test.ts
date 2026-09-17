import { EditorState } from "@codemirror/state";
import { externalDocumentChange } from "../../src/editor/documentSync";
import { describe, expect, it } from "vitest";
import { syncEditorDocument } from "../../src/editor/documentSync";

function fakeView(doc: string) {
  let state = EditorState.create({ doc });
  const echoed: string[] = [];
  const target = {
    get state() {
      return state;
    },
    dispatch(spec: Parameters<typeof syncEditorDocument>[0]["dispatch"] extends (t: infer T) => void ? T : never) {
      const transaction = state.update(spec);
      state = transaction.state;
      // Mirror @uiw/react-codemirror's update listener: user edits echo to
      // onChange, external ones do not.
      if (transaction.docChanged && !transaction.annotation(externalDocumentChange)) {
        echoed.push(state.doc.toString());
      }
    }
  };
  return { target, echoed, doc: () => state.doc.toString() };
}

describe("syncEditorDocument", () => {
  it("replaces the document synchronously when the value differs", () => {
    const view = fakeView("X# a\n\nBody of a.\n");

    expect(syncEditorDocument(view.target, "# b\n\nBody of b.\n")).toBe(true);
    expect(view.doc()).toBe("# b\n\nBody of b.\n");
  });

  it("does not dispatch when the document already matches", () => {
    const view = fakeView("same");

    expect(syncEditorDocument(view.target, "same")).toBe(false);
  });

  it("marks the replacement as external so it never echoes back as a user edit", () => {
    const view = fakeView("typed");

    syncEditorDocument(view.target, "outside version");

    expect(view.echoed).toEqual([]);
  });
});
