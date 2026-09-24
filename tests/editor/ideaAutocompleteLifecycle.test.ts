import { EditorState, type TransactionSpec } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ideaAutocompleteExtension, resetSharedAutocompleteCooldownForTests, type IdeaAutocompleteExtensionOptions } from "../../src/editor/ideaAutocomplete/extension";
import { defaultAutocompletePreferences } from "../../src/editor/ideaAutocomplete/options";
import type { IdeaAutocompleteResult } from "../../src/types/iliad";

// Run the actual plugin against real CodeMirror transactions without a DOM renderer.
function harness(request = vi.fn<() => Promise<IdeaAutocompleteResult>>().mockResolvedValue({ ok: true, insert: "quiet room." }), options: Partial<IdeaAutocompleteExtensionOptions> = {}) {
  const cancel = vi.fn();
  const status = vi.fn();
  const extensions = ideaAutocompleteExtension({
    enabled: true, language: "en", workspaceSessionId: "session", documentRelativePath: "draft.md",
    documentTitle: "Draft", autocompleteApiFallbackEnabled: false,
    requestAutocomplete: request, cancelAutocomplete: cancel, onStatusChange: status, ...options
  });
  const view = {
    hasFocus: true,
    state: EditorState.create({ doc: "She walked into the ", selection: { anchor: 20 }, extensions: [history()] }),
    dispatch(spec: TransactionSpec) {
      const transaction = view.state.update(spec);
      view.state = transaction.state;
      plugin.update({ state: view.state, transactions: [transaction], docChanged: transaction.docChanged,
        selectionSet: Boolean(transaction.selection), focusChanged: false, changes: transaction.changes } as ViewUpdate);
    }
  };
  const plugin = (extensions[0] as unknown as { create(view: EditorView): {
    suggestion: { insert: string } | null;
    update(update: ViewUpdate): void;
    triggerManual(kind?: "inline" | "sentence" | "paragraph" | "idea"): boolean;
    continueKey(): boolean;
    lengthKey(kind: "sentence" | "paragraph" | "idea"): boolean;
    accept(): boolean;
    dismiss(): boolean;
    destroy(): void;
    setComposing(composing: boolean): void;
    action(action: string): boolean;
  } }).create(view as unknown as EditorView);
  return { view, plugin, request, cancel, status };
}

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("window", globalThis); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); resetSharedAutocompleteCooldownForTests(); });

describe("autocomplete lifecycle", () => {
  it("does not cancel a menu-triggered request when the editor gains focus", async () => {
    const { plugin, view, cancel } = harness();
    plugin.triggerManual();
    plugin.update({ state: view.state, transactions: [], docChanged: false, selectionSet: false, focusChanged: true } as unknown as ViewUpdate);
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).not.toHaveBeenCalled();
    expect(plugin.suggestion?.insert).toBe("quiet room.");
    plugin.destroy();
  });
  it("streams a preview, accepts only that preview, and ignores late chunks and completion", async () => {
    let emit!: (event: { requestId: string; insert: string }) => void;
    let resolve!: (result: IdeaAutocompleteResult) => void;
    const unsubscribe = vi.fn();
    const request = vi.fn<() => Promise<IdeaAutocompleteResult>>().mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { view, plugin, cancel } = harness(request, { onPartial: (listener) => { emit = listener; return unsubscribe; } });
    plugin.triggerManual();
    const requestId = (request.mock.calls[0] as unknown as [{ requestId: string }])[0].requestId;
    emit({ requestId, insert: "quiet room with " });
    expect(plugin.suggestion?.insert).toBe("quiet room with ");
    plugin.accept();
    expect(view.state.doc.toString()).toBe("She walked into the quiet room with ");
    expect(plugin.suggestion).toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
    emit({ requestId, insert: "quiet room with a view." });
    resolve({ ok: true, insert: "quiet room with a view." });
    await vi.advanceTimersByTimeAsync(0);
    expect(plugin.suggestion).toBeNull();
    plugin.destroy();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("clears streamed ghosts when the final result fails", async () => {
    let emit!: (event: { requestId: string; insert: string }) => void;
    let resolve!: (result: IdeaAutocompleteResult) => void;
    const request = vi.fn<() => Promise<IdeaAutocompleteResult>>().mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { plugin } = harness(request, { onPartial: (listener) => { emit = listener; return () => undefined; } });
    plugin.triggerManual();
    const requestId = (request.mock.calls[0] as unknown as [{ requestId: string }])[0].requestId;
    emit({ requestId, insert: "quiet room with " });
    resolve({ ok: false, reason: "no_suggestion" });
    await vi.advanceTimersByTimeAsync(0);
    expect(plugin.suggestion).toBeNull();
    expect(plugin.accept()).toBe(false);
    plugin.destroy();
  });

  it("cycles requested alternatives locally and clears them when the document changes", async () => {
    const request = vi.fn<() => Promise<IdeaAutocompleteResult>>()
      .mockResolvedValueOnce({ ok: true, insert: "quiet room." }).mockResolvedValueOnce({ ok: true, insert: "empty hall." });
    const { plugin, view } = harness(request);
    plugin.triggerManual();
    await vi.advanceTimersByTimeAsync(0);
    plugin.action("new");
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ avoid: ["quiet room."] }));
    expect(plugin.action("previous")).toBe(true);
    expect(plugin.suggestion?.insert).toBe("quiet room.");
    expect(plugin.action("next")).toBe(true);
    expect(plugin.suggestion?.insert).toBe("empty hall.");
    expect(request).toHaveBeenCalledTimes(2);
    view.dispatch({ changes: { from: 20, insert: "different" }, selection: { anchor: 29 }, userEvent: "input.type" });
    expect(plugin.action("previous")).toBe(false);
    plugin.destroy();
  });

  it.each(["manual", "snoozed"])("keeps explicit requests available in %s mode", async (mode) => {
    const { view, plugin, request } = harness(undefined, {
      preferences: { ...defaultAutocompletePreferences, manualOnly: mode === "manual" },
      snoozedUntil: mode === "snoozed" ? Date.now() + 60_000 : 0
    });
    view.dispatch({ changes: { from: 20, insert: "old " }, selection: { anchor: 24 }, userEvent: "input.type" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).not.toHaveBeenCalled();
    expect(plugin.triggerManual()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    plugin.destroy();
  });
  it("accepts everything shown in one step and undoes acceptance separately", async () => {
    const { view, plugin, request } = harness();
    plugin.triggerManual();
    await vi.advanceTimersByTimeAsync(0);
    expect(plugin.accept()).toBe(true);
    expect(view.state.doc.toString()).toBe("She walked into the quiet room.");
    expect(plugin.suggestion).toBeNull();
    undo(view as unknown as EditorView);
    expect(view.state.doc.toString()).toBe("She walked into the ");
    expect(request).toHaveBeenCalledTimes(1);
    plugin.destroy();
  });

  it("grows one suggestion with the AI key: sentence, then paragraph, then idea", async () => {
    const request = vi.fn<() => Promise<IdeaAutocompleteResult>>()
      .mockResolvedValueOnce({ ok: true, insert: "quiet room." })
      .mockResolvedValueOnce({ ok: true, insert: " The lamps were off." })
      .mockResolvedValueOnce({ ok: true, insert: "\n\nShe waited." });
    const { view, plugin } = harness(request);
    expect(plugin.continueKey()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ suggestionKind: "sentence", extend: false }));
    expect(plugin.continueKey()).toBe(true);
    // The visible draft stays while the extension is requested.
    expect(plugin.suggestion?.insert).toBe("quiet room.");
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({
      suggestionKind: "paragraph", extend: true, prefix: "She walked into the quiet room.", avoid: []
    }));
    await vi.advanceTimersByTimeAsync(0);
    expect(plugin.suggestion?.insert).toBe("quiet room. The lamps were off.");
    plugin.continueKey();
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ suggestionKind: "idea", extend: true }));
    expect(plugin.suggestion?.insert).toBe("quiet room. The lamps were off.\n\nShe waited.");
    // Idea is the last step: the key is swallowed without another request.
    expect(plugin.continueKey()).toBe(true);
    expect(request).toHaveBeenCalledTimes(3);
    plugin.accept();
    expect(view.state.doc.toString()).toBe("She walked into the quiet room. The lamps were off.\n\nShe waited.");
    plugin.destroy();
  });

  it("keeps the visible draft when extending it fails, and drops it on an edit", async () => {
    const request = vi.fn<() => Promise<IdeaAutocompleteResult>>()
      .mockResolvedValueOnce({ ok: true, insert: "quiet room." })
      .mockResolvedValueOnce({ ok: false, reason: "timeout" });
    const { view, plugin, cancel, status } = harness(request);
    plugin.continueKey();
    await vi.advanceTimersByTimeAsync(0);
    plugin.continueKey();
    await vi.advanceTimersByTimeAsync(0);
    expect(plugin.suggestion?.insert).toBe("quiet room.");
    expect(status).toHaveBeenLastCalledWith(expect.objectContaining({ state: "shown", insert: "quiet room.", kind: "sentence" }));
    view.dispatch({ changes: { from: 20, insert: "x" }, selection: { anchor: 21 }, userEvent: "input.type" });
    expect(plugin.suggestion).toBeNull();
    expect(cancel).not.toHaveBeenCalled();
    plugin.destroy();
  });

  it("cancels an in-flight extension when the cursor moves", async () => {
    let resolve!: (result: IdeaAutocompleteResult) => void;
    const request = vi.fn<() => Promise<IdeaAutocompleteResult>>()
      .mockResolvedValueOnce({ ok: true, insert: "quiet room." })
      .mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const { view, plugin, cancel } = harness(request);
    plugin.continueKey();
    await vi.advanceTimersByTimeAsync(0);
    plugin.continueKey();
    view.dispatch({ selection: { anchor: 3 } });
    expect(cancel).toHaveBeenCalledTimes(1);
    resolve({ ok: true, insert: " The lamps were off." });
    await vi.advanceTimersByTimeAsync(0);
    expect(plugin.suggestion).toBeNull();
    plugin.destroy();
  });

  it("asks for a full idea in one request with its direct key", async () => {
    const request = vi.fn<() => Promise<IdeaAutocompleteResult>>().mockResolvedValue({ ok: true, insert: "quiet room.\n\nShe waited." });
    const { plugin } = harness(request);
    expect(plugin.lengthKey("idea")).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ suggestionKind: "idea", extend: false }));
    expect(plugin.suggestion?.insert).toBe("quiet room.\n\nShe waited.");
    plugin.destroy();
  });

  it("extends a visible shorter suggestion straight to the requested length", async () => {
    const request = vi.fn<() => Promise<IdeaAutocompleteResult>>()
      .mockResolvedValueOnce({ ok: true, insert: "quiet room." })
      .mockResolvedValueOnce({ ok: true, insert: "\n\nShe waited." });
    const { plugin } = harness(request);
    plugin.lengthKey("sentence");
    await vi.advanceTimersByTimeAsync(0);
    plugin.lengthKey("idea");
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ suggestionKind: "idea", extend: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(2);
    expect(plugin.suggestion?.insert).toBe("quiet room.\n\nShe waited.");
    plugin.destroy();
  });

  it("switches to a longer length mid-request instead of waiting", async () => {
    const request = vi.fn<() => Promise<IdeaAutocompleteResult>>()
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValueOnce({ ok: true, insert: "quiet room. The lamps were off." });
    const { plugin, cancel } = harness(request);
    plugin.lengthKey("sentence");
    plugin.lengthKey("paragraph");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ suggestionKind: "paragraph", extend: false }));
    await vi.advanceTimersByTimeAsync(0);
    expect(plugin.suggestion?.insert).toBe("quiet room. The lamps were off.");
    plugin.destroy();
  });

  it("never lets a length key act on a selection", () => {
    const { view, plugin, request } = harness();
    view.dispatch({ selection: { anchor: 4, head: 10 } });
    expect(plugin.lengthKey("idea")).toBe(true);
    expect(request).not.toHaveBeenCalled();
    plugin.destroy();
  });

  it("never lets the AI key edit a selection", () => {
    const { view, plugin, request } = harness();
    view.dispatch({ selection: { anchor: 4, head: 10 } });
    expect(plugin.continueKey()).toBe(true);
    expect(request).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe("She walked into the ");
    plugin.destroy();
  });

  it("typing the suggested prefix keeps the remainder without a new request", async () => {
    const { view, plugin, request } = harness();
    plugin.triggerManual();
    await vi.advanceTimersByTimeAsync(0);
    view.dispatch({ changes: { from: 20, insert: "qui" }, selection: { anchor: 23 }, userEvent: "input.type" });
    expect(plugin.suggestion?.insert).toBe("et room.");
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenCalledTimes(1);
    plugin.destroy();
  });

  it("does not start a pending automatic request after moving the cursor", async () => {
    const { view, plugin, request } = harness();
    view.dispatch({ changes: { from: 20, insert: "old " }, selection: { anchor: 24 }, userEvent: "input.type" });
    view.dispatch({ selection: { anchor: 5 } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).not.toHaveBeenCalled();
    plugin.destroy();
  });

  it("cancels pending automatic work when IME composition starts", async () => {
    const { view, plugin, request } = harness();
    view.dispatch({ changes: { from: 20, insert: "old " }, selection: { anchor: 24 }, userEvent: "input.type" });
    plugin.setComposing(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).not.toHaveBeenCalled();
    expect(plugin.triggerManual()).toBe(false);
    plugin.destroy();
  });

  it("ignores a stale rejection after Escape without blocking the next manual request", async () => {
    let reject!: (reason: Error) => void;
    const request = vi.fn<() => Promise<IdeaAutocompleteResult>>()
      .mockImplementationOnce(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }))
      .mockResolvedValue({ ok: true, insert: "quiet room." });
    const { plugin, cancel, status } = harness(request);
    plugin.triggerManual();
    expect(plugin.dismiss()).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    reject(new Error("Canceled"));
    await vi.advanceTimersByTimeAsync(0);
    expect(status).not.toHaveBeenCalledWith({ state: "failed", reason: "provider" });
    expect(plugin.triggerManual()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(plugin.suggestion?.insert).toBe("quiet room.");
    plugin.destroy();
  });

  it("allows an explicit paragraph request after repeated dismissals pause automatic suggestions", async () => {
    const { plugin, request } = harness();
    for (let i = 0; i < 3; i++) {
      plugin.triggerManual();
      await vi.advanceTimersByTimeAsync(0);
      plugin.dismiss();
    }
    expect(plugin.triggerManual("paragraph")).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ suggestionKind: "paragraph", trigger: "manual" }));
    plugin.destroy();
  });
});
