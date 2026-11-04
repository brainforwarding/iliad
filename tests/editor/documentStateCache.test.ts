import { history, redo, undo, undoDepth } from "@codemirror/commands";
import { EditorState, Facet, StateEffect, StateField } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { createDocumentStateCache } from "../../src/editor/documentStateCache";

function target(state: EditorState) {
  const editor = { state, dispatch: (transaction: { state: EditorState }) => { editor.state = transaction.state; } };
  return editor;
}

function edited(doc = "draft") {
  const state = EditorState.create({ doc, extensions: history() });
  return state.update({ changes: { from: doc.length, insert: "!" }, selection: { anchor: 2, head: 4 }, userEvent: "input.type" }).state;
}

describe("document writing state cache", () => {
  it("keeps independent undo/redo and backward selections for documents with identical text", () => {
    const cache = createDocumentStateCache();
    const a = edited().update({ selection: { anchor: 4, head: 2 } }).state;
    cache.capture("a", 0, a, { top: 700, left: 4 }, cache.generation("a"));
    const b = target(cache.createState("b", 0, "draft!", history()).state);
    expect(undo(b)).toBe(false);
    const restored = cache.createState("a", 0, "draft!", history());
    expect(restored.scroll).toEqual({ top: 700, left: 4 });
    expect(restored.state.selection.main).toMatchObject({ anchor: 4, head: 2 });
    const returned = target(restored.state);
    expect(undo(returned)).toBe(true);
    expect(returned.state.doc.toString()).toBe("draft");
    expect(redo(returned)).toBe(true);
    expect(returned.state.doc.toString()).toBe("draft!");
    expect(b.state.doc.toString()).toBe("draft!");
  });

  it("restores writing history with fresh transient fields and current path callbacks after relocation", () => {
    const cache = createDocumentStateCache();
    const effect = StateEffect.define<number>();
    const transient = StateField.define({ create: () => 0, update: (value, transaction) => {
      for (const item of transaction.effects) if (item.is(effect)) value = item.value;
      return value;
    } });
    const callback = Facet.define<() => string>();
    const state = edited().update({ effects: StateEffect.appendConfig.of([transient, callback.of(() => "/old.md")]) }).state
      .update({ effects: effect.of(99) }).state;
    cache.capture("stable-id", 1, state, { top: 12, left: 0 }, cache.generation("stable-id"));
    const restored = cache.createState("stable-id", 1, "draft!", [history(), transient, callback.of(() => "/renamed.md")]);
    expect(restored.restored).toBe(true);
    expect(undoDepth(restored.state)).toBe(1);
    expect(restored.state.field(transient)).toBe(0);
    expect(restored.state.facet(callback)[0]()).toBe("/renamed.md");
  });

  it("discards history when outside text differs, including a later return to the old text", () => {
    const cache = createDocumentStateCache();
    cache.capture("a", 0, edited(), { top: 70, left: 0 }, cache.generation("a"));
    const changed = cache.createState("a", 0, "outside", history());
    expect(changed.state.doc.toString()).toBe("outside");
    expect(changed.restored).toBe(false);
    expect(undoDepth(changed.state)).toBe(0);
    expect(cache.createState("a", 0, "draft!", history()).restored).toBe(false);
  });

  it("rejects a new authoritative revision even when its text matches", () => {
    const cache = createDocumentStateCache();
    cache.capture("a", 1, edited(), { top: 70, left: 0 }, cache.generation("a"));
    const restored = cache.createState("a", 2, "draft!", history());
    expect(restored.restored).toBe(false);
    expect(undoDepth(restored.state)).toBe(0);
  });

  it("does not replace normal writing state with a temporary review presentation", () => {
    const cache = createDocumentStateCache();
    cache.capture("a", 0, edited(), { top: 40, left: 0 }, cache.generation("a"));
    const review = cache.createState("a", 0, "review snapshot", [history(), EditorState.readOnly.of(true)], false);
    expect(review.restored).toBe(false);
    expect(review.state.readOnly).toBe(true);
    const returned = cache.createState("a", 0, "draft!", history());
    expect(returned.restored).toBe(true);
    expect(returned.state.readOnly).toBe(false);
    expect(undoDepth(returned.state)).toBe(1);
  });

  it.each(["delete", "invalidate", "clear"] as const)("cannot resurrect history after %s and a late outgoing snapshot", (operation) => {
    const cache = createDocumentStateCache();
    const generation = cache.generation("a");
    cache.capture("a", 0, edited(), { top: 40, left: 0 }, generation);
    if (operation === "clear") cache.clear();
    else cache[operation]("a");
    cache.capture("a", 0, edited(), { top: 40, left: 0 }, generation);
    expect(cache.createState("a", 0, "draft!", history()).restored).toBe(false);
  });
});
