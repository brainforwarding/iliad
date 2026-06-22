import { StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import type { DisplayReviewHunk } from "./diff";
import { intralineTokenDiff, type IntralineRange } from "./intralineDiff";

interface ReviewExtensionOptions {
  mode: "edit_file" | "create_file" | "delete_file";
  hunks: DisplayReviewHunk[];
  activeHunkId: string | null;
  createLineCount: number;
  onAcceptHunk?: (hunkId: string) => void;
  onRejectHunk?: (hunkId: string) => void;
  labels: {
    acceptChange?: string;
    rejectChange?: string;
  };
}

export function reviewSourceLineClasses(line: string) {
  const classes = ["cm-ai-review-source-line"];
  const headingMatch = /^(#{1,6})\s+/.exec(line);

  if (headingMatch) {
    classes.push("cm-ai-review-source-heading", `cm-ai-review-source-heading-${headingMatch[1].length}`);
  }

  if (/^\s*>\s?/.test(line)) {
    classes.push("cm-ai-review-source-blockquote");
  }

  if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
    classes.push("cm-ai-review-source-list");
  }

  if (/^\s*$/.test(line)) {
    classes.push("cm-ai-review-source-empty");
  }

  return classes.join(" ");
}

class InsertedTextWidget extends WidgetType {
  private readonly text: string;

  constructor(
    private readonly lines: string[],
    private readonly changedRangesByLine: IntralineRange[][],
    private readonly hunkId: string,
    private readonly active: boolean,
    private readonly onAcceptHunk: ((hunkId: string) => void) | undefined,
    private readonly onRejectHunk: ((hunkId: string) => void) | undefined,
    private readonly labels: ReviewExtensionOptions["labels"]
  ) {
    super();
    this.text = lines.join("\n");
  }

  eq(other: InsertedTextWidget) {
    return (
      this.hunkId === other.hunkId &&
      this.active === other.active &&
      sameLineRanges(this.changedRangesByLine, other.changedRangesByLine) &&
      this.onAcceptHunk === other.onAcceptHunk &&
      this.onRejectHunk === other.onRejectHunk &&
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
    content.className = "cm-ai-review-source-block";
    wrapper.append(content);

    for (let index = 0; index < this.lines.length; index += 1) {
      const row = document.createElement("div");
      row.className = `cm-ai-review-source-row ${reviewSourceLineClasses(this.lines[index])}`;

      const sourceText = document.createElement("span");
      sourceText.className = `cm-ai-review-line-inserted${this.active ? " is-active" : ""}`;
      appendSourceParts(sourceText, this.lines[index], this.changedRangesByLine[index] ?? [], "cm-ai-review-inserted-token");

      if (this.lines[index].length === 0) {
        sourceText.append(document.createTextNode("\u00a0"));
      }

      row.append(sourceText);
      content.append(row);
    }

    if (this.onAcceptHunk && this.onRejectHunk) {
      wrapper.append(reviewButtons(this.hunkId, this.onAcceptHunk, this.onRejectHunk, this.labels));
    }

    return wrapper;
  }

  ignoreEvent(event: Event) {
    return event.type !== "mousedown" && event.type !== "click";
  }
}

class SourceLineWidget extends WidgetType {
  constructor(
    private readonly text: string,
    private readonly changedRanges: IntralineRange[],
    private readonly changedClassName: string,
    private readonly baseClassName: string,
    private readonly active: boolean
  ) {
    super();
  }

  eq(other: SourceLineWidget) {
    return (
      this.text === other.text &&
      this.changedClassName === other.changedClassName &&
      this.baseClassName === other.baseClassName &&
      this.active === other.active &&
      sameRanges(this.changedRanges, other.changedRanges)
    );
  }

  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className = `cm-ai-review-inline-source ${reviewSourceLineClasses(this.text)} ${this.baseClassName}${
      this.active ? " is-active" : ""
    }`;
    appendSourceParts(wrapper, this.text, this.changedRanges, this.changedClassName);
    return wrapper;
  }
}

class EmptyChangedLineWidget extends WidgetType {
  constructor(
    private readonly className: string,
    private readonly active: boolean
  ) {
    super();
  }

  eq(other: EmptyChangedLineWidget) {
    return this.className === other.className && this.active === other.active;
  }

  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className = `${this.className}${this.active ? " is-active" : ""}`;
    wrapper.textContent = "\u00a0";
    return wrapper;
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
  actions.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onRejectHunk(hunkId);
  });

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

interface LineIntralineDiff {
  oldRanges: IntralineRange[];
  newRanges: IntralineRange[];
}

function hunkLineDiffs(hunk: DisplayReviewHunk): LineIntralineDiff[] {
  const count = Math.max(hunk.oldLines.length, hunk.newLines.length);

  return Array.from({ length: count }, (_, index) => intralineTokenDiff(hunk.oldLines[index] ?? "", hunk.newLines[index] ?? ""));
}

function insertedLineRanges(hunk: DisplayReviewHunk, lineDiffs: LineIntralineDiff[]) {
  return hunk.newLines.map((line, index) => {
    const ranges = lineDiffs[index]?.newRanges ?? [];
    return ranges.length > 0 ? ranges : [{ from: 0, to: line.length }];
  });
}

function collapsedSourceLine(hunk: DisplayReviewHunk, lineDiffs: LineIntralineDiff[]) {
  if (hunk.oldLines.length !== 1 || hunk.newLines.length !== 1) {
    return null;
  }

  const diff = lineDiffs[0];

  if (!diff) {
    return null;
  }

  if (diff.oldRanges.length === 0 && diff.newRanges.length > 0) {
    return {
      kind: "insert" as const,
      text: hunk.newLines[0],
      ranges: diff.newRanges
    };
  }

  if (diff.oldRanges.length > 0 && diff.newRanges.length === 0) {
    return {
      kind: "delete" as const,
      text: hunk.oldLines[0],
      ranges: diff.oldRanges
    };
  }

  return null;
}

function appendSourceParts(parent: HTMLElement, text: string, ranges: IntralineRange[], changedClassName: string) {
  let cursor = 0;

  for (const range of ranges) {
    const from = Math.max(cursor, Math.min(range.from, text.length));
    const to = Math.max(from, Math.min(range.to, text.length));

    if (from > cursor) {
      parent.append(document.createTextNode(text.slice(cursor, from)));
    }

    if (to > from) {
      const changed = document.createElement("span");
      changed.className = changedClassName;
      changed.textContent = text.slice(from, to);
      parent.append(changed);
    }

    cursor = to;
  }

  if (cursor < text.length) {
    parent.append(document.createTextNode(text.slice(cursor)));
  }
}

function sameRanges(left: IntralineRange[], right: IntralineRange[]) {
  return left.length === right.length && left.every((range, index) => range.from === right[index].from && range.to === right[index].to);
}

function sameLineRanges(left: IntralineRange[][], right: IntralineRange[][]) {
  return left.length === right.length && left.every((ranges, index) => sameRanges(ranges, right[index] ?? []));
}

function addChangedLineDecoration(
  ranges: Range<Decoration>[],
  line: { from: number; to: number },
  className: string,
  active = false
) {
  if (line.from < line.to) {
    ranges.push(Decoration.mark({ class: `${className}${active ? " is-active" : ""}` }).range(line.from, line.to));
    return;
  }

  ranges.push(
    Decoration.widget({
      widget: new EmptyChangedLineWidget(className, active),
      side: 1
    }).range(line.from)
  );
}

function buildDecorations(state: EditorState, options: ReviewExtensionOptions): DecorationSet {
  const ranges: Range<Decoration>[] = [];

  if (options.mode === "create_file" || options.mode === "delete_file") {
    const className = options.mode === "create_file" ? "cm-ai-review-line-inserted" : "cm-ai-review-line-removed";

    for (let lineNumber = 1; lineNumber <= Math.max(1, options.createLineCount); lineNumber += 1) {
      const line = lineAt(state, lineNumber);
      ranges.push(Decoration.line({ class: reviewSourceLineClasses(line.text) }).range(line.from));
      addChangedLineDecoration(ranges, line, className);
    }

    return Decoration.set(ranges, true);
  }

  for (const hunk of options.hunks) {
    const active = hunk.id === options.activeHunkId;
    const lineDiffs = hunkLineDiffs(hunk);
    const collapsed = collapsedSourceLine(hunk, lineDiffs);

    if (collapsed) {
      const line = lineAt(state, hunk.displayOldStartLine);
      const widget = new SourceLineWidget(
        collapsed.text,
        collapsed.ranges,
        collapsed.kind === "insert" ? "cm-ai-review-inserted-token" : "cm-ai-review-removed-token",
        collapsed.kind === "insert" ? "cm-ai-review-line-inserted" : "cm-ai-review-line-removed",
        active
      );
      if (line.from < line.to) {
        ranges.push(Decoration.replace({ widget }).range(line.from, line.to));
      } else {
        ranges.push(Decoration.widget({ widget, side: 1 }).range(line.from));
      }
      ranges.push(
        Decoration.widget({
          widget: new HunkControlsWidget(hunk.id, active, options.onAcceptHunk, options.onRejectHunk, options.labels),
          side: 1,
          block: true
        }).range(line.to)
      );
      continue;
    }

    if (hunk.oldLines.length > 0) {
      for (let lineNumber = hunk.displayOldStartLine; lineNumber <= hunk.displayOldEndLine; lineNumber += 1) {
        const line = lineAt(state, lineNumber);
        const hunkLineIndex = lineNumber - hunk.displayOldStartLine;
        ranges.push(Decoration.line({ class: reviewSourceLineClasses(hunk.oldLines[hunkLineIndex] ?? line.text) }).range(line.from));

        addChangedLineDecoration(ranges, line, "cm-ai-review-line-removed", active);
      }

      for (let index = 0; index < hunk.oldLines.length; index += 1) {
        const line = lineAt(state, hunk.displayOldStartLine + index);

        for (const range of lineDiffs[index]?.oldRanges ?? []) {
          const from = line.from + range.from;
          const to = line.from + range.to;

          if (from < to) {
            ranges.push(Decoration.mark({ class: "cm-ai-review-removed-token" }).range(from, to));
          }
        }
      }
    }

    if (hunk.newLines.length > 0) {
      const anchorLine = hunk.displayAnchorLine <= 0 ? 1 : Math.min(hunk.displayAnchorLine, state.doc.lines);
      const anchor = hunk.displayAnchorLine <= 0 ? 0 : lineAt(state, anchorLine).to;
      ranges.push(
        Decoration.widget({
          widget: new InsertedTextWidget(
            hunk.newLines,
            insertedLineRanges(hunk, lineDiffs),
            hunk.id,
            active,
            options.onAcceptHunk,
            options.onRejectHunk,
            options.labels
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
