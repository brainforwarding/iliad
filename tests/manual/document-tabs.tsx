import { undo, undoDepth } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { useMemo, useState } from "react";
import { CodeMirrorHost } from "../../src/editor/CodeMirrorHost";
import { createDocumentStateCache } from "../../src/editor/documentStateCache";
import "../../src/styles/app.css";

const initial = Array.from({ length: 120 }, (_, index) => `Paragraph ${index}. A draft with enough writing to scroll.`).join("\n\n");
const documents: Record<string, string> = { a: initial, b: initial };
const cache = createDocumentStateCache();
let view: EditorView;
let mounts = 0;
let activate: (id: string) => void;
let reload: () => void;
const changes: string[] = [];

function App() {
  const [id, setId] = useState("a");
  const [activation, setActivation] = useState(0);
  const [revision, setRevision] = useState(0);
  const [value, setValue] = useState(initial);
  activate = (next) => {
    setId(next);
    setValue(next === "review" ? "Read-only review snapshot" : documents[next]);
    setActivation((number) => number + 1);
  };
  reload = () => {
    documents[id] = "Authoritative outside revision";
    setValue(documents[id]);
    setRevision((number) => number + 1);
  };
  const extensions = useMemo(() => [
    EditorView.lineWrapping,
    EditorView.theme({ ".cm-content": { fontFamily: "Georgia", fontSize: "18px", padding: "24px" } }),
    EditorState.readOnly.of(id === "review"), EditorView.editable.of(id !== "review")
  ], [id]);
  return <div style={{ padding: 20, height: "100vh", overflow: "auto" }}>
    <p>Document state QA. A and B share initial text and retain independent history/selection/outer scroll.</p>
    <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
      {["a", "b", "review"].map((key) => <button key={key} onClick={() => activate(key)}>{key === id ? `Selected ${key}` : key}</button>)}
      <button onClick={() => reload()}>Reload outside text</button>
      <button onClick={() => { void runChecks().then((result) => { document.querySelector("#result")!.textContent = result; }); }}>Run checks</button>
    </div>
    <div className="editor-surface" style={{ height: 260, width: 700, border: "1px solid #aaa" }}>
      <CodeMirrorHost documentId={id} documentRevision={revision} documentCache={cache} activationId={activation}
        cacheable={id !== "review"} value={value} extensions={extensions} basicSetup={{ lineNumbers: false, foldGutter: false }}
        onCreateEditor={(created) => { view = created; mounts += 1; }}
        onChange={(text) => { changes.push(id); documents[id] = text; setValue(text); }} />
    </div>
    <pre id="result">Ready</pre>
  </div>;
}

const settle = async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); };
const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
const surface = () => document.querySelector<HTMLElement>(".editor-surface")!;
async function runChecks() {
  flushSync(() => activate("a"));
  await settle();
  flushSync(() => view.dispatch({ changes: { from: 0, insert: "A edit\n" }, selection: { anchor: 10, head: 4 }, userEvent: "input.type" }));
  surface().scrollTop = 650;
  const scroll = surface().scrollTop;
  flushSync(() => activate("b"));
  await settle();
  assert(undoDepth(view.state) === 0, "B inherited A's undo");
  assert(surface().scrollTop === 0, "B inherited A's scroll");
  flushSync(() => view.dispatch({ changes: { from: 0, insert: "B edit\n" }, userEvent: "input.type" }));
  assert(changes.at(-1) === "b", "B edit used stale A callback");
  flushSync(() => activate("a"));
  await settle();
  assert(view.state.selection.main.anchor === 10 && view.state.selection.main.head === 4, "A selection lost");
  assert(Math.abs(surface().scrollTop - scroll) < 2, "A outer scroll lost");
  assert(view.state.doc.toString().startsWith("A edit"), "A text lost");
  // Several committed switches before any browser frame must preserve the
  // intended outgoing scroll even while a restored document is still laying out.
  flushSync(() => activate("b"));
  flushSync(() => activate("a"));
  flushSync(() => activate("b"));
  flushSync(() => activate("a"));
  await settle();
  assert(Math.abs(surface().scrollTop - scroll) < 2, "Rapid activation lost A outer scroll");
  flushSync(() => activate("review"));
  await settle();
  assert(view.state.readOnly && undoDepth(view.state) === 0, "Review inherited writing history/editability");
  flushSync(() => activate("a"));
  await settle();
  assert(!view.state.readOnly && undoDepth(view.state) === 1, "Review damaged normal writing cache");
  flushSync(() => { undo(view); });
  assert(view.state.doc.toString() === initial, "A undo crossed documents");
  flushSync(() => reload());
  await settle();
  assert(undoDepth(view.state) === 0 && !undo(view), "Outside reload entered writer undo");
  assert(mounts === 1, "Document switching remounted EditorView");
  assert(document.querySelectorAll(".cm-editor").length === 1, "Multiple editor views mounted");
  return "Passed: independent undo, fresh callbacks, selection, outer scroll, review isolation, outside reset, one mounted view.";
}

Object.assign(window, { documentTabsQA: { runChecks, snapshot: () => ({ mounts, changes, text: view.state.doc.toString(), scroll: surface().scrollTop }) } });
createRoot(document.querySelector("#root")!).render(<App />);
