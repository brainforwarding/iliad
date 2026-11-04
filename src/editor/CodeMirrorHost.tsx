import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { Compartment, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup, type BasicSetupOptions } from "@uiw/codemirror-extensions-basic-setup";
import { useLayoutEffect, useRef } from "react";
import { externalDocumentChange, syncEditorDocument } from "./documentSync";
import { createDocumentStateCache, type DocumentScrollPosition, type DocumentStateCache } from "./documentStateCache";

export interface CodeMirrorHostProps {
  /** Stable writing identity, preserved across an in-app rename or move. */
  documentId?: string;
  /** Increment when an authoritative external baseline replaces this document. */
  documentRevision?: number;
  documentCache?: DocumentStateCache;
  /** Increment on committed presentation switches, including A → B → A. */
  activationId?: number;
  /** False for temporary outside-review presentations. */
  cacheable?: boolean;
  value: string;
  extensions: Extension[];
  basicSetup: BasicSetupOptions;
  onChange?: (value: string) => void;
  onCreateEditor?: (view: EditorView) => void;
}

/**
 * CodeMirror's default keymap without Mod-[ / Mod-] (indentLess/indentMore):
 * those keys are the app's Back/Forward document history, and a handled
 * CodeMirror binding would prevent the event before the window sees it.
 * Tab / Shift-Tab (indentWithTab) still indent.
 */
export const APP_OWNED_EDITOR_KEYS = new Set(["Mod-[", "Mod-]", "Ctrl-Tab", "Ctrl-Shift-Tab"]);
export const editorDefaultKeymap = defaultKeymap.filter((binding) => !binding.key || !APP_OWNED_EDITOR_KEYS.has(binding.key));

const hostTheme = EditorView.theme(
  {
    "& .cm-scroller": {
      height: "100% !important"
    }
  },
  { dark: false }
);

/**
 * Mounts a CodeMirror `EditorView` under React and keeps it in step with
 * `value` and `extensions`.
 *
 * Iliad owns this instead of `@uiw/react-codemirror` so the document sync is
 * synchronous and unconditional (see `syncEditorDocument`): the buffer must
 * match app state before paint and before any keystroke can land on an old
 * document. `onChange` fires only for edits that originate in the editor.
 */
export function CodeMirrorHost({
  documentId = "document", documentRevision = 0, documentCache, activationId = 0, cacheable = true,
  value, extensions, basicSetup: basicSetupOptions, onChange, onCreateEditor
}: CodeMirrorHostProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onCreateEditorRef = useRef(onCreateEditor);
  const appExtensions = useRef(new Compartment()).current;
  const localCache = useRef(createDocumentStateCache()).current;
  const cache = documentCache ?? localCache;
  const activeRef = useRef<{ documentId: string; revision: number; activationId: number; cacheable: boolean; cache: DocumentStateCache; generation: number } | null>(null);
  const restoreFrameRef = useRef<number | null>(null);
  const pendingScrollRef = useRef<DocumentScrollPosition | null>(null);

  useLayoutEffect(() => {
    onChangeRef.current = onChange;
    onCreateEditorRef.current = onCreateEditor;
  });

  // Keep one native view while switching complete states. This effect also runs
  // before paint: neither typing nor plugin callbacks may see the old document.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const view = viewRef.current;
    const active = activeRef.current;
    const changed = !active || active.documentId !== documentId || active.revision !== documentRevision ||
      active.activationId !== activationId || active.cacheable !== cacheable || active.cache !== cache;
    const surface = container.closest<HTMLElement>(".editor-surface");
    const base = [
      basicSetup({ ...basicSetupOptions, defaultKeymap: false }),
      basicSetupOptions.defaultKeymap === false ? [] : keymap.of(editorDefaultKeymap),
      keymap.of([indentWithTab]), hostTheme,
      EditorView.updateListener.of((update) => {
        if ((update.docChanged || update.selectionSet) && restoreFrameRef.current !== null) {
          window.cancelAnimationFrame(restoreFrameRef.current);
          restoreFrameRef.current = null;
          pendingScrollRef.current = null;
        }
        if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(externalDocumentChange))) {
          onChangeRef.current?.(update.state.doc.toString());
        }
      }),
      appExtensions.of(extensions)
    ];
    if (changed) {
      const outgoingScroll = pendingScrollRef.current ?? { top: surface?.scrollTop ?? 0, left: surface?.scrollLeft ?? 0 };
      if (restoreFrameRef.current !== null) window.cancelAnimationFrame(restoreFrameRef.current);
      restoreFrameRef.current = null;
      pendingScrollRef.current = null;
      if (view && active?.cacheable && !(active.documentId === documentId && active.revision !== documentRevision)) {
        active.cache.capture(active.documentId, active.revision, view.state, outgoingScroll, active.generation);
      }
      if (active?.documentId === documentId && active.revision !== documentRevision) cache.invalidate(documentId);
      const next = cache.createState(documentId, documentRevision, value, base, cacheable);
      const attached = view ?? new EditorView({ parent: container, state: next.state });
      if (view) view.setState(next.state);
      viewRef.current = attached;
      const identity = { documentId, revision: documentRevision, activationId, cacheable, cache, generation: cache.generation(documentId) };
      activeRef.current = identity;
      if (surface) {
        pendingScrollRef.current = next.scroll;
        surface.scrollTop = next.scroll.top;
        surface.scrollLeft = next.scroll.left;
        // setState and visual Markdown change the surface's measured height.
        // Reapply after layout, guarded against another rapid activation.
        restoreFrameRef.current = window.requestAnimationFrame(() => {
          restoreFrameRef.current = null;
          if (activeRef.current !== identity) return;
          pendingScrollRef.current = null;
          surface.scrollTop = next.scroll.top;
          surface.scrollLeft = next.scroll.left;
        });
      }
      if (!view) onCreateEditorRef.current?.(attached);
      // setState does not publish a ViewUpdate; refresh selection consumers.
      attached.dispatch({});
    } else if (view) {
      view.dispatch({ effects: appExtensions.reconfigure(extensions) });
      if (syncEditorDocument(view, value)) {
        // Preserve external-replacement comment mapping and no-echo behavior,
        // then remove the old baseline and external replacement from undo.
        cache.invalidate(documentId);
        const selection = view.state.selection;
        const next = cache.createState(documentId, documentRevision, value, base, false);
        view.setState(next.state.update({ selection }).state);
        activeRef.current = { ...active!, generation: cache.generation(documentId) };
        view.dispatch({});
      }
    }
  }, [activationId, appExtensions, basicSetupOptions, cache, cacheable, documentId, documentRevision, extensions, value]);

  useLayoutEffect(() => {
    return () => {
      if (restoreFrameRef.current !== null) window.cancelAnimationFrame(restoreFrameRef.current);
      viewRef.current?.destroy();
      viewRef.current = null;
      activeRef.current = null;
      pendingScrollRef.current = null;
    };
  }, []);

  return <div className="cm-theme cm-theme-light" ref={containerRef} />;
}
