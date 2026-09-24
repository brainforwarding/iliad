// Interactive QA with synthetic text and a fake stream. Never calls a provider.
import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { EditorView } from "@codemirror/view";
import { EditorPane } from "../../src/components/EditorPane";
import { WritingAssistsMenu } from "../../src/components/WritingAssistsMenu";
import { useAutocompletePreferences } from "../../src/preferences/autocompletePreferences";
import { appStrings } from "../../src/i18n/strings";
import type { IdeaAutocompleteRequest, IdeaAutocompleteResult, FileTreeNode } from "../../src/types/iliad";
import "../../src/styles/app.css";

const files = ["The lighthouse", "The garden"].map((name, index) => ({ name: `${name}.md`, kind: "markdown", path: `/preview/chapter-${index}.md`, relativePath: `chapter-${index}.md` } as FileTreeNode));
const listeners = new Set<(event: { requestId: string; insert: string }) => void>();
const canceled = new Set<string>();
const onPartial = (listener: (event: { requestId: string; insert: string }) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
let generation = 0;
async function requestAutocomplete(request: IdeaAutocompleteRequest): Promise<IdeaAutocompleteResult> {
  const variants = ["the tide had already turned, leaving the harbor strangely quiet.", "a light moved behind the glass, then vanished.", "someone had left a cup of tea beside the window."];
  const text = variants[generation++ % variants.length];
  const insert = request.extend
    ? request.suggestionKind === "idea"
      ? "\n\nBy noon the fog had lifted. From the gallery she could see the whole bay.\n\n- The boats were back.\n- The bell had stopped."
      : " The stairs curled upward into the dark, and every step rang like a bell."
    : request.suggestionKind === "paragraph" && /[.!?]$/.test(request.prefix) ? `\n\n${text[0].toUpperCase()}${text.slice(1)}` : text;
  await new Promise((resolve) => setTimeout(resolve, 250));
  for (const length of [26, 45]) {
    if (canceled.delete(request.requestId)) return { ok: false, reason: "aborted" };
    const prefix = insert.slice(0, length).replace(/\S+$/, "");
    for (const listener of listeners) listener({ requestId: request.requestId, insert: prefix });
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return canceled.delete(request.requestId) ? { ok: false, reason: "aborted" } : { ok: true, insert };
}
const cancel = (id: string) => { canceled.add(id); };
// A fake selection rewrite so the ✦ AI menu and its inline review can be exercised.
const selectionComments = { comments: [], onCreateComment: () => undefined, onUpdateComment: () => undefined, onDeleteComment: () => undefined,
  onPositionsChanged: () => undefined, onFullReplacement: () => undefined };
const fakeRewrite = async (_id: string, text: string, selection: { from: number; to: number }, options?: { mode?: "tighten" | "edit"; instruction?: string }) => {
  await new Promise((resolve) => setTimeout(resolve, 600));
  const selected = text.slice(selection.from, selection.to);
  const rewrite = options?.mode === "edit" ? `${selected.trim()} (${options.instruction?.split(" ").slice(0, 3).join(" ")}…)` : selected.split(" ").slice(0, -2).join(" ");
  return { ok: true as const, rewrite: text.slice(0, selection.from) + rewrite + text.slice(selection.to), unchanged: false };
};
const nothing = async () => null;
const ignoreLink = () => undefined;

function Preview() {
  const [chapter, setChapter] = useState(0);
  const [text, setText] = useState(["# The lighthouse\n\nMara reached the lighthouse just before dawn. The path was empty, but the door stood open.\n\nShe stepped inside and noticed ", "# The garden\n\nBy morning, the garden had changed. Every window faced the same tree.\n\nUnder its branches, "]);
  const [open, setOpen] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [corrector, setCorrector] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [language, setLanguage] = useState<"en" | "es">("en");
  const strings = appStrings[language];
  const options = useAutocompletePreferences("/preview", files[chapter].relativePath);
  const writingAssists = useMemo(() => ({
    correctorEnabled: false, autocompleteEnabled: enabled,
    workspaceSessionId: "preview", documentRelativePath: files[chapter].relativePath, language,
    preferences: options.preferences, guidance: options.guidance, snoozedUntil: options.snoozedUntil,
    labels: { corrector: strings.editor.writingCorrector, autocomplete: strings.editor.ideaAutocomplete },
    autocompleteIdea: requestAutocomplete, cancelAutocompleteIdea: cancel, onPartial
  }), [enabled, chapter, language, options.preferences, options.guidance, options.snoozedUntil, strings]);
  return <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--editor)" }}>
    <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 24px", borderBottom: "1px solid var(--hairline)", fontFamily: "var(--font-ui)" }}>
      <div><button onClick={() => setChapter((n) => 1 - n)}>{files[chapter].name}</button> <button onClick={() => setLanguage(language === "en" ? "es" : "en")}>{language.toUpperCase()}</button></div>
      <WritingAssistsMenu labels={strings.writingAssists} menuRef={menuRef} open={open} onToggleOpen={() => setOpen(!open)}
        correctorEnabled={corrector} onSetCorrectorEnabled={setCorrector} correctorAvailable={true}
        autocompleteEnabled={enabled} onSetAutocompleteEnabled={setEnabled}
        geminiKey={{ hasKey: true, last4: "demo" }} onSaveGeminiKey={async () => undefined} onGetGeminiKey={() => undefined} hasDocument={true}
        preferences={options.preferences} onPreferencesChange={options.setPreferences} guidance={options.guidance} onGuidanceChange={options.setGuidance}
        snoozed={options.snoozedUntil > Date.now()} onToggleSnooze={options.toggleSnooze} onResetShortcuts={options.resetShortcuts} />
    </header>
    <EditorPane file={files[chapter]} value={text[chapter]} editorFontSize={19} editorFontPreset="serif" labels={strings.editor} review={null}
      selectionComments={selectionComments}
      tighten={{ enabled: true, minChars: 12, maxChars: 4000, labels: strings.editor.tighten, run: fakeRewrite, cancel: () => undefined }}
      writingAssists={writingAssists} onChange={(value) => setText((current) => current.map((item, index) => index === chapter ? value : item))}
      onInsertImage={nothing} onInsertImageReference={nothing} onOpenLink={ignoreLink}
      onEditorViewChange={(editor) => { view.current = editor; editor.dispatch({ selection: { anchor: editor.state.doc.length } }); }} />
  </div>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
