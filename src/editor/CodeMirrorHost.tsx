import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup, type BasicSetupOptions } from "@uiw/codemirror-extensions-basic-setup";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { externalDocumentChange, syncEditorDocument } from "./documentSync";

export interface CodeMirrorHostProps {
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
export const APP_OWNED_EDITOR_KEYS = new Set(["Mod-[", "Mod-]"]);
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
export function CodeMirrorHost({ value, extensions, basicSetup: basicSetupOptions, onChange, onCreateEditor }: CodeMirrorHostProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onCreateEditorRef = useRef(onCreateEditor);
  const appExtensions = useRef(new Compartment()).current;
  const initialRef = useRef({ value, extensions, basicSetupOptions });

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onCreateEditorRef.current = onCreateEditor;
  }, [onCreateEditor]);

  useLayoutEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const initial = initialRef.current;
    const created = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: initial.value,
        extensions: [
          // basicSetup's own copy of the default keymap is swapped for the
          // filtered one right after it, so it keeps the same precedence
          // relative to the app's keymaps.
          basicSetup({ ...initial.basicSetupOptions, defaultKeymap: false }),
          initial.basicSetupOptions.defaultKeymap === false ? [] : keymap.of(editorDefaultKeymap),
          keymap.of([indentWithTab]),
          hostTheme,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || update.transactions.some((transaction) => transaction.annotation(externalDocumentChange))) {
              return;
            }

            onChangeRef.current?.(update.state.doc.toString());
          }),
          appExtensions.of(initial.extensions)
        ]
      })
    });

    setView(created);
    onCreateEditorRef.current?.(created);

    return () => {
      created.destroy();
      setView(null);
    };
  }, [appExtensions]);

  useEffect(() => {
    if (!view || extensions === initialRef.current.extensions) {
      return;
    }

    view.dispatch({ effects: appExtensions.reconfigure(extensions) });
  }, [appExtensions, extensions, view]);

  useLayoutEffect(() => {
    if (view) {
      syncEditorDocument(view, value);
    }
  }, [value, view]);

  return <div className="cm-theme cm-theme-light" ref={containerRef} />;
}
