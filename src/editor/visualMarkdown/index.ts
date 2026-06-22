import { StateEffect, StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { isFenceLine } from "../../markdown/mathDelimiters";
import { isActiveLine, type BlockedRange } from "./activeRanges";
import {
  addBlockLineDecorations,
  addInactiveBlockSyntaxDecorations,
  addSetextMarkerDecoration,
  addThematicBreakDecoration,
  collectSetextHeadings,
  isThematicBreak
} from "./blocks";
import {
  addEmphasisDecorations,
  addEscapeDecorations,
  addImageDecorations,
  addInlineMathDecorations,
  addInlineCodeDecorations,
  addLinkDecorations,
  addStrongDecorations
} from "./inline";
import { collectDisplayMathBlocks, type DisplayMathBlock } from "./math";
import { addTableLineDecorations, collectTableLines } from "./tables";
import { DisplayMathWidget } from "./widgets";

export interface VisualMarkdownOptions {
  documentPath: string;
  blockedLineRanges?: Array<{ from: number; to: number }>;
  initialEditorFocused?: boolean;
  initialEditorInteracted?: boolean;
  labels: {
    markdownImage: string;
    youtubeVideo: string;
    markTaskIncomplete: string;
    markTaskComplete: string;
  };
  onOpenLink: (href: string) => void | Promise<void>;
}

const editorFocusedEffect = StateEffect.define<boolean>();
export const visualMarkdownInteractionResetEffect = StateEffect.define<{
  focused: boolean;
  interacted: boolean;
}>();
const editorFocusedField = StateField.define<boolean>({
  create() {
    return false;
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(visualMarkdownInteractionResetEffect)) {
        return effect.value.focused;
      }

      if (effect.is(editorFocusedEffect)) {
        return effect.value;
      }
    }

    return value;
  }
});
const editorInteractedField = StateField.define<boolean>({
  create() {
    return false;
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(visualMarkdownInteractionResetEffect)) {
        return effect.value.interacted;
      }
    }

    if (value) {
      return true;
    }

    for (const effect of transaction.effects) {
      if (effect.is(editorFocusedEffect) && effect.value) {
        return true;
      }
    }

    return value;
  }
});

function lineIsBlocked(lineNumber: number, ranges: Array<{ from: number; to: number }> | undefined) {
  return ranges?.some((range) => lineNumber >= range.from && lineNumber <= range.to) ?? false;
}

function buildDecorations(
  state: EditorState,
  options: VisualMarkdownOptions,
  editorFocused: boolean,
  editorInteracted: boolean
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const document = state.doc;

  // Fenced-code lines (including the ``` / ~~~ delimiters) are left untouched:
  // no math/inline/line decorations, so e.g. `$$` inside a code block stays literal.
  const fencedLines = new Set<number>();
  let inFence = false;
  for (let lineNumber = 1; lineNumber <= document.lines; lineNumber += 1) {
    if (isFenceLine(document.line(lineNumber).text)) {
      fencedLines.add(lineNumber);
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      fencedLines.add(lineNumber);
    }
  }

  const tableLines = collectTableLines(document);
  const setextHeadings = collectSetextHeadings(document);
  const displayMathBlocks = collectDisplayMathBlocks(document, fencedLines);
  const displayMathLineBlocks = new Map<number, DisplayMathBlock>();

  for (const block of displayMathBlocks.values()) {
    for (let mathLineNumber = block.fromLine; mathLineNumber <= block.toLine; mathLineNumber += 1) {
      displayMathLineBlocks.set(mathLineNumber, block);
    }
  }

  for (let lineNumber = 1; lineNumber <= document.lines; lineNumber += 1) {
    const line = document.line(lineNumber);
    const text = line.text;

    if (fencedLines.has(lineNumber)) {
      continue;
    }

    const active = isActiveLine(state, lineNumber, editorFocused, editorInteracted);
    const reviewBlocked = lineIsBlocked(lineNumber, options.blockedLineRanges);

    if (reviewBlocked) {
      continue;
    }

    const displayMathBlock = displayMathBlocks.get(lineNumber);
    const insideDisplayMathBlock = displayMathLineBlocks.get(lineNumber);
    const tableLine = tableLines.get(lineNumber);
    const blockedRanges: BlockedRange[] = [];
    const setextHeadingLevel = setextHeadings.contentLineLevels.get(lineNumber);
    const setextMarkerLevel = setextHeadings.markerLineLevels.get(lineNumber);
    const setextContentActive = Boolean(
      setextMarkerLevel && isActiveLine(state, lineNumber - 1, editorFocused, editorInteracted)
    );

    const headingMatch = addBlockLineDecorations(ranges, line.from, text);

    if (displayMathBlock) {
      const displayMathBlocked = Array.from(
        { length: displayMathBlock.toLine - displayMathBlock.fromLine + 1 },
        (_, index) => displayMathBlock.fromLine + index
      ).some(
        (mathLineNumber) =>
          isActiveLine(state, mathLineNumber, editorFocused, editorInteracted) ||
          lineIsBlocked(mathLineNumber, options.blockedLineRanges)
      );

      if (!displayMathBlocked) {
        ranges.push(Decoration.line({ class: "cm-md-display-math-line" }).range(line.from));
        ranges.push(
          Decoration.replace({
            widget: new DisplayMathWidget(displayMathBlock.tex),
            block: true
          }).range(displayMathBlock.from, displayMathBlock.to)
        );
        lineNumber = displayMathBlock.toLine;
      }

      // Whether collapsed or shown as source (active/blocked), never apply
      // inline/line markdown decorations to a display-math line.
      continue;
    }

    if (insideDisplayMathBlock) {
      continue;
    }

    if (setextHeadingLevel) {
      ranges.push(Decoration.line({ class: `cm-md-heading-line cm-md-heading-${setextHeadingLevel}` }).range(line.from));
    }

    if (setextMarkerLevel) {
      if (!active && !setextContentActive) {
        addSetextMarkerDecoration(ranges, line.from, line.to);
      }

      continue;
    }

    if (!active && isThematicBreak(text)) {
      addThematicBreakDecoration(ranges, line.from, line.to);
      continue;
    }

    if (tableLine && !active) {
      addTableLineDecorations(ranges, line.from, line.to, tableLine, options.onOpenLink);
      continue;
    }

    if (active) {
      addStrongDecorations(ranges, line.from, text, blockedRanges, { hideSyntax: false });
      addEmphasisDecorations(ranges, line.from, text, blockedRanges, { hideSyntax: false });
      addInlineCodeDecorations(ranges, line.from, text, blockedRanges, { hideSyntax: false });
    } else {
      addInactiveBlockSyntaxDecorations(ranges, line.from, text, headingMatch, blockedRanges, options.labels);
      addImageDecorations(ranges, line.from, text, options.documentPath, blockedRanges, options.labels);
      addStrongDecorations(ranges, line.from, text, blockedRanges);
      addEmphasisDecorations(ranges, line.from, text, blockedRanges);
      addInlineCodeDecorations(ranges, line.from, text, blockedRanges);
      addInlineMathDecorations(ranges, state, line.from, text, blockedRanges, editorFocused, editorInteracted);
      addEscapeDecorations(ranges, line.from, text, blockedRanges);
    }

    addLinkDecorations(ranges, state, line.from, text, blockedRanges, options.onOpenLink, editorFocused, editorInteracted);
  }

  return Decoration.set(ranges, true);
}

function safeBuildDecorations(
  state: EditorState,
  options: VisualMarkdownOptions,
  editorFocused: boolean,
  editorInteracted: boolean
): DecorationSet {
  try {
    return buildDecorations(state, options, editorFocused, editorInteracted);
  } catch (error) {
    console.warn("Visual Markdown decorations disabled for this update.", error);
    return Decoration.none;
  }
}

export function visualMarkdown(options: VisualMarkdownOptions) {
  // State-derived decoration source (not a ViewPlugin): this is the only legal
  // place to emit block decorations such as the display-math widget. Recomputes
  // on document and selection changes.
  const focusField = options.initialEditorFocused ? editorFocusedField.init(() => true) : editorFocusedField;
  const interactedField =
    options.initialEditorFocused || options.initialEditorInteracted
      ? editorInteractedField.init(() => true)
      : editorInteractedField;

  const decorations = EditorView.decorations.compute(
    ["doc", "selection", editorFocusedField, editorInteractedField],
    (state) => safeBuildDecorations(state, options, state.field(editorFocusedField), state.field(editorInteractedField))
  );

  const linkHandler = EditorView.domEventHandlers({
    mousedown(event) {
      const link = (event.target as Element | null)?.closest<HTMLElement>(".cm-md-link[data-cm-md-link-href]");

      if (!link) {
        return false;
      }

      event.preventDefault();
      event.stopPropagation();
      return true;
    },
    click(event) {
      const link = (event.target as Element | null)?.closest<HTMLElement>(".cm-md-link[data-cm-md-link-href]");
      const href = link?.dataset.cmMdLinkHref;

      if (!href) {
        return false;
      }

      event.preventDefault();
      event.stopPropagation();
      void options.onOpenLink(href);
      return true;
    }
  });

  return [
    focusField,
    interactedField,
    EditorView.focusChangeEffect.of((_state, focusing) => editorFocusedEffect.of(focusing)),
    decorations,
    linkHandler
  ];
}
