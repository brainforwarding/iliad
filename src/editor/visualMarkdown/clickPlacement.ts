import { EditorSelection } from "@codemirror/state";
import { EditorView, type DecorationSet } from "@codemirror/view";

interface Boundary { from: number; to: number; edge: "open" | "close" }

/** Snapshot the source position before a click reveals this line's markers. */
export function hiddenFormatClickPosition(view: EditorView, event: MouseEvent): number | null {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos === null) return null;
  const line = view.state.doc.lineAt(pos);
  const boundaries: Boundary[] = [];
  for (const decorations of view.state.facet(EditorView.decorations)) {
    if (typeof decorations === "function") continue;
    (decorations as DecorationSet).between(line.from, line.to, (from, to, decoration) => {
      const edge = decoration.spec.inlineFormatBoundary;
      if (edge === "open" || edge === "close") boundaries.push({ from, to, edge });
    });
  }
  boundaries.sort((a, b) => a.from - b.from);
  const groups: Boundary[] = [];
  for (const boundary of boundaries) {
    const previous = groups[groups.length - 1];
    if (previous?.edge === boundary.edge && previous.to === boundary.from) previous.to = boundary.to;
    else groups.push({ ...boundary });
  }
  for (const boundary of groups) {
    if (pos < boundary.from || pos > boundary.to) continue;
    const coords = view.coordsAtPos(boundary.edge === "open" ? boundary.to : boundary.from,
      boundary.edge === "open" ? 1 : -1);
    // A click farther into the following space belongs to ordinary source
    // placement. Capture this before focusing reveals the hidden markers.
    if (!coords || event.clientX > coords.left + 1) continue;
    if (boundary.edge === "close") return boundary.from;
    const preceding = view.state.sliceDoc(Math.max(line.from, boundary.from - 1), boundary.from);
    return /\s/.test(preceding) ? boundary.to : boundary.from;
  }
  // Even away from an edge, revealing earlier markers moves the text under
  // the pointer. Retain the original hit instead of hit-testing it a second time.
  return boundaries.length ? pos : null;
}

export function inlineFormatMouseSelection() {
  return EditorView.mouseSelectionStyle.of((view, event) => {
    if (event.button !== 0 || event.detail !== 1 || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return null;
    const position = hiddenFormatClickPosition(view, event);
    if (position === null) return null;
    let anchor = position;
    return {
      get(current) {
        // Starting the gesture uses the saved pre-reveal position. Once it
        // becomes a drag, keep that anchor and use normal character hit testing.
        const head = current === event ? anchor : view.posAtCoords({ x: current.clientX, y: current.clientY }, false);
        return EditorSelection.single(anchor, head);
      },
      update(update) {
        if (update.docChanged) anchor = update.changes.mapPos(anchor);
      }
    };
  });
}
