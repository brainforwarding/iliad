import type { Range, Text } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import katex from "katex";

export type TableAlignment = "left" | "center" | "right";
type TableLineKind = "header" | "separator" | "body";

export interface TableLineInfo {
  alignments: TableAlignment[];
  cells: string[];
  columnTemplate: string;
  kind: TableLineKind;
}

class TableRowWidget extends WidgetType {
  constructor(
    private readonly cells: string[],
    private readonly alignments: TableAlignment[],
    private readonly columnTemplate: string,
    private readonly kind: Exclude<TableLineKind, "separator">,
    private readonly onOpenLink: (href: string) => void | Promise<void>
  ) {
    super();
  }

  eq(other: TableRowWidget) {
    return (
      this.kind === other.kind &&
      this.cells.join("\u0000") === other.cells.join("\u0000") &&
      this.alignments.join("\u0000") === other.alignments.join("\u0000") &&
      this.columnTemplate === other.columnTemplate &&
      this.onOpenLink === other.onOpenLink
    );
  }

  toDOM() {
    const row = document.createElement("span");
    const rowClasses = ["cm-md-table-row", this.kind === "header" ? "is-header" : "is-body"];

    if (this.cells.every((cell) => cell.trim() === "")) {
      rowClasses.push("is-empty");
    }

    row.className = rowClasses.join(" ");
    row.style.gridTemplateColumns = this.columnTemplate;

    this.cells.forEach((cell, index) => {
      const cellElement = document.createElement("span");
      cellElement.className = `cm-md-table-cell is-${this.alignments[index] ?? "left"}`;
      appendInlineMarkdown(cellElement, cell, this.onOpenLink);
      row.appendChild(cellElement);
    });

    return row;
  }

  ignoreEvent() {
    return false;
  }
}

function appendText(parent: HTMLElement, text: string) {
  if (text) {
    parent.appendChild(document.createTextNode(text));
  }
}

function appendStyledText(parent: HTMLElement, className: string, text: string) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  parent.appendChild(span);
}

function appendInlineMath(parent: HTMLElement, tex: string) {
  const span = document.createElement("span");
  span.className = "cm-md-inline-math";

  try {
    katex.render(tex, span, {
      displayMode: false,
      throwOnError: true
    });
  } catch {
    span.classList.add("is-error");
    span.textContent = tex;
  }

  parent.appendChild(span);
}

function appendLink(
  parent: HTMLElement,
  label: string,
  href: string,
  onOpenLink: (href: string) => void | Promise<void>,
  className?: string
) {
  const link = document.createElement("a");
  link.className = className ? `cm-md-link ${className}` : "cm-md-link";
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.title = href;
  appendInlineMarkdown(link, label || href, onOpenLink, false);
  link.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  link.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void onOpenLink(href);
  });
  parent.appendChild(link);
}

function appendInlineMarkdown(
  parent: HTMLElement,
  text: string,
  onOpenLink: (href: string) => void | Promise<void>,
  allowLinks = true
) {
  if (!text) {
    parent.appendChild(document.createTextNode("\u00a0"));
    return;
  }

  const inlinePattern =
    /(`[^`]+`|\$[^$\n]+\$|\\\([^\n]+?\\\)|\*\*\[[^\]]+\]\([^)]+\)\*\*|\*\[[^\]]+\]\([^)]+\)\*|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*\s][^*]*?\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = inlinePattern.exec(text))) {
    const token = match[0];
    appendText(parent, text.slice(cursor, match.index));

    if (token.startsWith("`")) {
      appendStyledText(parent, "cm-md-inline-code", token.slice(1, -1));
    } else if (token.startsWith("$")) {
      appendInlineMath(parent, token.slice(1, -1));
    } else if (token.startsWith("\\(")) {
      appendInlineMath(parent, token.slice(2, -2).trim());
    } else if (allowLinks && token.startsWith("**[")) {
      const linkMatch = /^\*\*\[([^\]]+)\]\(([^)]+)\)\*\*$/.exec(token);
      if (linkMatch) {
        appendLink(parent, linkMatch[1], linkMatch[2], onOpenLink, "cm-md-strong");
      } else {
        appendText(parent, token);
      }
    } else if (allowLinks && token.startsWith("*[")) {
      const linkMatch = /^\*\[([^\]]+)\]\(([^)]+)\)\*$/.exec(token);
      if (linkMatch) {
        appendLink(parent, linkMatch[1], linkMatch[2], onOpenLink, "cm-md-emphasis");
      } else {
        appendText(parent, token);
      }
    } else if (allowLinks && token.startsWith("[")) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (linkMatch) {
        appendLink(parent, linkMatch[1], linkMatch[2], onOpenLink);
      } else {
        appendText(parent, token);
      }
    } else if (token.startsWith("**")) {
      const span = document.createElement("span");
      span.className = "cm-md-strong";
      appendInlineMarkdown(span, token.slice(2, -2), onOpenLink, allowLinks);
      parent.appendChild(span);
    } else if (token.startsWith("*")) {
      const span = document.createElement("span");
      span.className = "cm-md-emphasis";
      appendInlineMarkdown(span, token.slice(1, -1), onOpenLink, allowLinks);
      parent.appendChild(span);
    } else {
      appendText(parent, token);
    }

    cursor = match.index + token.length;
  }

  appendText(parent, text.slice(cursor));
}

class TableSeparatorWidget extends WidgetType {
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-table-separator";

    return span;
  }

  ignoreEvent() {
    return false;
  }
}

export function parseTableCells(text: string) {
  const trimmed = text.trim();

  if (!trimmed.includes("|")) {
    return null;
  }

  const withoutOuterPipes = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells = withoutOuterPipes.split("|").map((cell) => cell.trim());

  return cells.length >= 2 ? cells : null;
}

function parseSeparatorAlignments(text: string, expectedCellCount: number): TableAlignment[] | null {
  const cells = parseTableCells(text);

  if (!cells || cells.length !== expectedCellCount) {
    return null;
  }

  const alignments: TableAlignment[] = [];

  for (const cell of cells) {
    const marker = cell.replace(/\s+/g, "");

    if (!/^:?-{3,}:?$/.test(marker)) {
      return null;
    }

    if (marker.startsWith(":") && marker.endsWith(":")) {
      alignments.push("center");
    } else if (marker.endsWith(":")) {
      alignments.push("right");
    } else {
      alignments.push("left");
    }
  }

  return alignments;
}

function columnTemplateFromCellCount(cellCount: number) {
  return `repeat(${cellCount}, minmax(0, 1fr))`;
}

export function collectTableLines(document: Text) {
  const tableLines = new Map<number, TableLineInfo>();
  let lineNumber = 1;

  while (lineNumber < document.lines) {
    const headerLine = document.line(lineNumber);
    const headerCells = parseTableCells(headerLine.text);

    if (!headerCells) {
      lineNumber += 1;
      continue;
    }

    const separatorLine = document.line(lineNumber + 1);
    const alignments = parseSeparatorAlignments(separatorLine.text, headerCells.length);

    if (!alignments) {
      lineNumber += 1;
      continue;
    }

    const rows: Array<{ cells: string[]; kind: TableLineKind; lineNumber: number }> = [
      { cells: headerCells, kind: "header", lineNumber },
      { cells: [], kind: "separator", lineNumber: lineNumber + 1 }
    ];
    let nextLineNumber = lineNumber + 2;

    while (nextLineNumber <= document.lines) {
      const rowCells = parseTableCells(document.line(nextLineNumber).text);

      if (!rowCells || rowCells.length !== headerCells.length) {
        break;
      }

      rows.push({ cells: rowCells, kind: "body", lineNumber: nextLineNumber });
      nextLineNumber += 1;
    }

    const columnTemplate = columnTemplateFromCellCount(headerCells.length);

    for (const row of rows) {
      tableLines.set(row.lineNumber, {
        alignments,
        cells: row.cells,
        columnTemplate,
        kind: row.kind,
      });
    }

    lineNumber = nextLineNumber;
  }

  return tableLines;
}

export function addTableLineDecorations(
  ranges: Range<Decoration>[],
  lineFrom: number,
  lineTo: number,
  tableLine: TableLineInfo,
  onOpenLink: (href: string) => void | Promise<void>
) {
  if (tableLine.kind === "separator") {
    ranges.push(Decoration.line({ class: "cm-md-table-separator-line" }).range(lineFrom));
    ranges.push(Decoration.replace({ widget: new TableSeparatorWidget() }).range(lineFrom, lineTo));
    return;
  }

  const lineClass = tableLine.cells.every((cell) => cell.trim() === "")
    ? "cm-md-table-line cm-md-table-empty-line"
    : "cm-md-table-line";

  ranges.push(Decoration.line({ class: lineClass }).range(lineFrom));
  ranges.push(
    Decoration.replace({
      widget: new TableRowWidget(
        tableLine.cells,
        tableLine.alignments,
        tableLine.columnTemplate,
        tableLine.kind,
        onOpenLink
      )
    }).range(lineFrom, lineTo)
  );
}
