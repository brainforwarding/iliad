import { StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReviewMarkdown } from "../../components/markdown/ReviewMarkdown";
import type { DisplayReviewHunk } from "./diff";

interface ReviewExtensionOptions {
  mode: "edit_file" | "create_file";
  hunks: DisplayReviewHunk[];
  activeHunkId: string | null;
  createLineCount: number;
  onAcceptHunk?: (hunkId: string) => void;
  onRejectHunk?: (hunkId: string) => void;
  onOpenLink?: (href: string) => void | Promise<void>;
  labels: {
    acceptChange?: string;
    rejectChange?: string;
  };
}

// React roots mounted inside inserted-block widgets, keyed by their DOM node so
// they can be unmounted in WidgetType.destroy().
const insertedRoots = new WeakMap<HTMLElement, Root>();

class InsertedTextWidget extends WidgetType {
  private readonly text: string;

  constructor(
    private readonly lines: string[],
    private readonly hunkId: string,
    private readonly active: boolean,
    private readonly onAcceptHunk: ((hunkId: string) => void) | undefined,
    private readonly onRejectHunk: ((hunkId: string) => void) | undefined,
    private readonly labels: ReviewExtensionOptions["labels"],
    private readonly onOpenLink: ((href: string) => void | Promise<void>) | undefined
  ) {
    super();
    this.text = lines.join("\n");
  }

  eq(other: InsertedTextWidget) {
    return (
      this.hunkId === other.hunkId &&
      this.active === other.active &&
      this.onAcceptHunk === other.onAcceptHunk &&
      this.onRejectHunk === other.onRejectHunk &&
      this.onOpenLink === other.onOpenLink &&
      this.labels.acceptChange === other.labels.acceptChange &&
      this.labels.rejectChange === other.labels.rejectChange &&
      this.text === other.text
    );
  }

  toDOM() {
    const wrapper = document.createElement("div");
    wrapper.className = `cm-ai-review-inserted-block${this.active ? " is-active" : ""}`;
    wrapper.dataset.hunkId = this.hunkId;

    const content = document.createElement("div");
    content.className = "cm-ai-review-rendered-host";
    wrapper.append(content);

    const root = createRoot(content);
    root.render(createElement(ReviewMarkdown, { text: this.text, onOpenLink: this.onOpenLink }));
    insertedRoots.set(wrapper, root);

    if (this.onAcceptHunk && this.onRejectHunk) {
      wrapper.append(reviewButtons(this.hunkId, this.onAcceptHunk, this.onRejectHunk, this.labels));
    }

    return wrapper;
  }

  destroy(dom: HTMLElement) {
    const root = insertedRoots.get(dom);

    if (root) {
      insertedRoots.delete(dom);
      // Defer so we never unmount during CodeMirror's own update/render cycle.
      queueMicrotask(() => root.unmount());
    }
  }

  ignoreEvent(event: Event) {
    return event.type !== "mousedown" && event.type !== "click";
  }
}

class HunkControlsWidget extends WidgetType {
  constructor(
    private readonly hunkId: string,
    private readonly active: boolean,
    private readonly onAcceptHunk: ((hunkId: string) => void) | undefined,
    private readonly onRejectHunk: ((hunkId: string) => void) | undefined,
    private readonly labels: ReviewExtensionOptions["labels"]
  ) {
    super();
  }

  eq(other: HunkControlsWidget) {
    return (
      this.hunkId === other.hunkId &&
      this.active === other.active &&
      this.onAcceptHunk === other.onAcceptHunk &&
      this.onRejectHunk === other.onRejectHunk
    );
  }

  toDOM() {
    const wrapper = document.createElement("div");
    wrapper.className = `cm-ai-review-controls${this.active ? " is-active" : ""}`;

    if (this.onAcceptHunk && this.onRejectHunk) {
      wrapper.append(reviewButtons(this.hunkId, this.onAcceptHunk, this.onRejectHunk, this.labels));
    }

    return wrapper;
  }

  ignoreEvent(event: Event) {
    return event.type !== "mousedown" && event.type !== "click";
  }
}

function reviewButtons(
  hunkId: string,
  onAcceptHunk: (hunkId: string) => void,
  onRejectHunk: (hunkId: string) => void,
  labels: ReviewExtensionOptions["labels"]
) {
  const actions = document.createElement("span");
  actions.className = "cm-ai-review-actions";

  const accept = document.createElement("button");
  accept.type = "button";
  accept.textContent = labels.acceptChange ?? "Accept";
  accept.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onAcceptHunk(hunkId);
  });

  const reject = document.createElement("button");
  reject.type = "button";
  reject.textContent = labels.rejectChange ?? "Reject";
  reject.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onRejectHunk(hunkId);
  });

  actions.append(accept, reject);
  return actions;
}

function lineAt(state: EditorState, lineNumber: number) {
  return state.doc.line(Math.max(1, Math.min(lineNumber, state.doc.lines)));
}

function buildDecorations(state: EditorState, options: ReviewExtensionOptions): DecorationSet {
  const ranges: Range<Decoration>[] = [];

  if (options.mode === "create_file") {
    for (let lineNumber = 1; lineNumber <= Math.max(1, options.createLineCount); lineNumber += 1) {
      ranges.push(Decoration.line({ class: "cm-ai-review-line-inserted" }).range(lineAt(state, lineNumber).from));
    }

    return Decoration.set(ranges, true);
  }

  for (const hunk of options.hunks) {
    const active = hunk.id === options.activeHunkId;

    if (hunk.oldLines.length > 0) {
      const fromLine = lineAt(state, hunk.displayOldStartLine);
      const toLine = lineAt(state, hunk.displayOldEndLine);

      for (let lineNumber = hunk.displayOldStartLine; lineNumber <= hunk.displayOldEndLine; lineNumber += 1) {
        ranges.push(Decoration.line({ class: `cm-ai-review-line-removed${active ? " is-active" : ""}` }).range(lineAt(state, lineNumber).from));
      }

      if (fromLine.from < toLine.to) {
        ranges.push(Decoration.mark({ class: "cm-ai-review-removed-text" }).range(fromLine.from, toLine.to));
      }
    }

    if (hunk.newLines.length > 0) {
      const anchorLine = hunk.displayAnchorLine <= 0 ? 1 : Math.min(hunk.displayAnchorLine, state.doc.lines);
      const anchor = hunk.displayAnchorLine <= 0 ? 0 : lineAt(state, anchorLine).to;
      ranges.push(
        Decoration.widget({
          widget: new InsertedTextWidget(
            hunk.newLines,
            hunk.id,
            active,
            options.onAcceptHunk,
            options.onRejectHunk,
            options.labels,
            options.onOpenLink
          ),
          side: hunk.displayAnchorLine <= 0 ? -1 : 1,
          block: true
        }).range(anchor)
      );
    } else if (hunk.oldLines.length > 0) {
      const anchor = lineAt(state, hunk.displayOldEndLine).to;
      ranges.push(
        Decoration.widget({
          widget: new HunkControlsWidget(hunk.id, active, options.onAcceptHunk, options.onRejectHunk, options.labels),
          side: 1,
          block: true
        }).range(anchor)
      );
    }
  }

  return Decoration.set(ranges, true);
}

export function aiReviewExtension(options: ReviewExtensionOptions) {
  const decorations = StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(state, options);
    },
    update(value, transaction) {
      return transaction.docChanged ? buildDecorations(transaction.state, options) : value;
    }
  });

  return [decorations, EditorView.decorations.from(decorations)];
}
