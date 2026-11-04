import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { inlineFormattingExtension } from "../../src/editor/inlineFormatting";
import { visualMarkdown } from "../../src/editor/visualMarkdown";
import "../../src/styles/app.css";

const sample = "Click another line to hide its Markdown.\n\n**First word** here\nSome **bold words** here\nSome *italic words* here\nSome ***combined words*** here";
let view: EditorView;
function reset(doc = sample, anchor = 0, focused = false, blockedLineRanges: Array<{ from: number; to: number }> = []) {
  view?.destroy();
  view = new EditorView({
    parent: document.querySelector("#editor")!,
    state: EditorState.create({ doc, selection: { anchor }, extensions: [
      history(), keymap.of([...defaultKeymap, ...historyKeymap]), inlineFormattingExtension(),
      EditorView.lineWrapping,
      EditorView.theme({
        "&": { padding: "24px", maxWidth: "700px", fontSize: "20px", background: "white" },
        ".cm-content": { fontFamily: "Georgia, serif" },
        ".cm-line": { padding: "4px 0" }
      }),
      visualMarkdown({ documentPath: "/qa/sample.md", blockedLineRanges,
        initialEditorFocused: focused,
        labels: { markdownImage: "image", youtubeVideo: "video", markTaskIncomplete: "incomplete", markTaskComplete: "complete" },
        onOpenLink: () => undefined }),
      EditorView.updateListener.of(() => {
        document.querySelector("#status")!.textContent = JSON.stringify(snapshot(), null, 2);
      })
    ] })
  });
  if (focused) view.focus();
  else (document.querySelector("#reset") as HTMLButtonElement).focus();
}
function snapshot() {
  return { doc: view.state.doc.toString(), anchor: view.state.selection.main.anchor, head: view.state.selection.main.head };
}
function coords(pos: number, side: -1 | 1 = 1) {
  const rect = view.coordsAtPos(pos, side)!;
  return { x: rect.left, y: (rect.top + rect.bottom) / 2 };
}
Object.assign(window, { formattingQA: { reset, snapshot, coords, select: (anchor: number, head = anchor) => {
  view.dispatch({ selection: { anchor, head } }); view.focus();
} } });
document.querySelector("#reset")!.addEventListener("click", () => reset());
reset();
