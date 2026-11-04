import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { DocumentActivation } from "../../src/editor/documentStateCache";
import { insertImageReferences, insertImages } from "../../src/editor/imageDropPaste";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("asynchronous image insertion", () => {
  it.each(["paste", "reference"])("ignores a late %s result after A → B → A", async (kind) => {
    const activation = new DocumentActivation();
    const isCurrent = activation.capture();
    const dispatch = vi.fn();
    const view = { state: EditorState.create({ doc: "A" }), dispatch } as unknown as EditorView;
    const image = deferred<string>();
    const run = kind === "paste"
      ? insertImages(view, 1, [{} as File], () => image.promise, isCurrent)
      : insertImageReferences(view, 1, ["image.png"], () => image.promise, isCurrent);
    activation.enter();
    activation.enter();
    image.resolve("![image](image.png)");
    await run;
    expect(dispatch).not.toHaveBeenCalled();
    expect(activation.capture()()).toBe(true);
  });

  it("inserts a result into its current activation", async () => {
    const activation = new DocumentActivation();
    const dispatch = vi.fn();
    const view = { state: EditorState.create({ doc: "A" }), dispatch } as unknown as EditorView;
    await insertImages(view, 1, [{} as File], async () => "![image](image.png)", activation.capture());
    expect(dispatch).toHaveBeenCalledWith({
      changes: { from: 1, insert: "\n\n![image](image.png)\n" },
      selection: { anchor: 23 }, scrollIntoView: true
    });
  });

  it("stops a batch before starting additional imports after switching documents", async () => {
    const activation = new DocumentActivation();
    const dispatch = vi.fn();
    const view = { state: EditorState.create({ doc: "A" }), dispatch } as unknown as EditorView;
    const image = deferred<string>();
    const insert = vi.fn(() => image.promise);
    const run = insertImages(view, 1, [{} as File, {} as File], insert, activation.capture());
    activation.enter();
    image.resolve("![image](image.png)");
    await run;
    expect(insert).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
