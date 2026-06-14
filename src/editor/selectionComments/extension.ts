import { Prec, StateField, type ChangeDesc, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";

export interface SelectionCommentWashRange {
  id: string;
  from: number;
  to: number;
  /** Sent comments keep their wash for ~200ms while it fades out. */
  fading?: boolean;
}

export interface SelectionCommentPositionUpdate {
  id: string;
  from: number;
  to: number;
}

export type SelectionCommentMapping =
  | { type: "none" }
  | { type: "full-replacement" }
  | { type: "mapped"; updates: SelectionCommentPositionUpdate[] };

export interface SelectionCommentsExtensionOptions {
  documentPath: string;
  ranges: SelectionCommentWashRange[];
  provisionalRange: { from: number; to: number } | null;
  /** Distinct graphite wash on the range being adjusted; decoration-only. */
  provisionalTightenRange?: { from: number; to: number } | null;
  onPositionsChanged?: (documentPath: string, updates: SelectionCommentPositionUpdate[]) => void;
  onFullReplacement?: (documentPath: string, documentText: string) => void;
  onMouseUpSelection?: (view: EditorView) => void;
  onMouseMove?: (event: MouseEvent, view: EditorView) => void;
  onEditorUpdate?: (update: ViewUpdate) => void;
  onCommentShortcut?: (view: EditorView) => boolean;
  onTightenShortcut?: (view: EditorView) => boolean;
  onEscape?: (view: EditorView) => boolean;
}

interface WashSpan {
  from: number;
  to: number;
  fading: boolean;
}

function mergeSpans(spans: Array<{ from: number; to: number }>) {
  const sorted = spans
    .filter((span) => span.to > span.from)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: Array<{ from: number; to: number }> = [];

  for (const span of sorted) {
    const last = merged[merged.length - 1];

    if (last && span.from <= last.to) {
      last.to = Math.max(last.to, span.to);
    } else {
      merged.push({ from: span.from, to: span.to });
    }
  }

  return merged;
}

/**
 * Produces disjoint wash spans so overlapping comments never compound
 * visually: pending ranges (plus the provisional composing range) merge into
 * one solid layer; fading spans are clipped against the solid layer.
 */
export function mergeWashSpans(
  ranges: SelectionCommentWashRange[],
  provisionalRange: { from: number; to: number } | null,
  documentLength: number
): WashSpan[] {
  const clamp = (value: number) => Math.max(0, Math.min(value, documentLength));
  const solidInputs = ranges
    .filter((range) => !range.fading)
    .map((range) => ({ from: clamp(range.from), to: clamp(range.to) }));

  if (provisionalRange) {
    solidInputs.push({ from: clamp(provisionalRange.from), to: clamp(provisionalRange.to) });
  }

  const solid = mergeSpans(solidInputs);
  const fading = mergeSpans(
    ranges.filter((range) => range.fading).map((range) => ({ from: clamp(range.from), to: clamp(range.to) }))
  );
  const spans: WashSpan[] = solid.map((span) => ({ ...span, fading: false }));

  for (const span of fading) {
    let cursor = span.from;

    for (const block of solid) {
      if (block.to <= cursor) {
        continue;
      }

      if (block.from >= span.to) {
        break;
      }

      if (block.from > cursor) {
        spans.push({ from: cursor, to: Math.min(block.from, span.to), fading: true });
      }

      cursor = Math.max(cursor, block.to);
    }

    if (cursor < span.to) {
      spans.push({ from: cursor, to: span.to, fading: true });
    }
  }

  return spans.sort((a, b) => a.from - b.from || a.to - b.to);
}

export function buildSelectionCommentDecorations(
  state: EditorState,
  ranges: SelectionCommentWashRange[],
  provisionalRange: { from: number; to: number } | null,
  provisionalTightenRange: { from: number; to: number } | null = null
): DecorationSet {
  try {
    const spans = mergeWashSpans(ranges, provisionalRange, state.doc.length);
    const decorations: Range<Decoration>[] = spans.map((span) =>
      Decoration.mark({
        class: span.fading ? "cm-comment-wash cm-comment-wash-fading" : "cm-comment-wash"
      }).range(span.from, span.to)
    );

    if (provisionalTightenRange) {
      const clamp = (value: number) => Math.max(0, Math.min(value, state.doc.length));
      const from = clamp(provisionalTightenRange.from);
      const to = clamp(provisionalTightenRange.to);

      if (to > from) {
        decorations.push(Decoration.mark({ class: "cm-tighten-wash" }).range(from, to));
      }
    }

    return Decoration.set(decorations, true);
  } catch (error) {
    // Defensive: never crash the editor over a wash (visualMarkdown precedent).
    console.warn("Selection comment washes disabled for this update.", error);
    return Decoration.none;
  }
}

/**
 * Classifies a transaction for comment-position upkeep. A change spanning the
 * whole previous document is a controlled full-content replacement (document
 * switch reusing the same CM instance, or an applied agent proposal): mapping
 * across it would garble positions, so the caller re-anchors instead.
 */
export function selectionCommentMappingForChanges(
  changes: ChangeDesc,
  previousDocumentLength: number,
  ranges: Array<Pick<SelectionCommentWashRange, "id" | "from" | "to">>
): SelectionCommentMapping {
  let fullReplacement = false;
  changes.iterChangedRanges((fromA, toA) => {
    if (fromA === 0 && toA === previousDocumentLength) {
      fullReplacement = true;
    }
  });

  if (fullReplacement) {
    return { type: "full-replacement" };
  }

  const updates: SelectionCommentPositionUpdate[] = [];

  for (const range of ranges) {
    // Insertions exactly at a boundary stay outside the commented range:
    // assoc 1 for `from`, assoc -1 for `to`.
    const from = changes.mapPos(range.from, 1);
    const to = Math.max(from, changes.mapPos(range.to, -1));

    if (from !== range.from || to !== range.to) {
      updates.push({ id: range.id, from, to });
    }
  }

  return updates.length > 0 ? { type: "mapped", updates } : { type: "none" };
}

/**
 * Stateless editor extension for selection comments (the aiReviewExtension
 * pattern): React state is authoritative and rebuilds this extension through
 * the `extensions` useMemo on every CRUD/position change. The StateField below
 * only derives decorations — it seeds from props and maps through edits until
 * React reseeds it, so washes track typing between rebuilds.
 */
export function selectionCommentsExtension(options: SelectionCommentsExtensionOptions) {
  const decorations = StateField.define<DecorationSet>({
    create(state) {
      return buildSelectionCommentDecorations(
        state,
        options.ranges,
        options.provisionalRange,
        options.provisionalTightenRange ?? null
      );
    },
    update(value, transaction) {
      return transaction.docChanged ? value.map(transaction.changes) : value;
    }
  });

  // Closure cache of live positions: between React rebuilds, consecutive
  // transactions must map cumulatively. The cache reseeds from authoritative
  // props whenever the extension instance is rebuilt.
  let tracked = options.ranges.map((range) => ({ id: range.id, from: range.from, to: range.to }));

  const listener = EditorView.updateListener.of((update) => {
    options.onEditorUpdate?.(update);

    if (!update.docChanged) {
      return;
    }

    const mapping = selectionCommentMappingForChanges(update.changes, update.startState.doc.length, tracked);

    if (mapping.type === "full-replacement") {
      options.onFullReplacement?.(options.documentPath, update.state.doc.toString());
      return;
    }

    if (mapping.type === "mapped") {
      const byId = new Map(mapping.updates.map((item) => [item.id, item]));
      tracked = tracked.map((range) => byId.get(range.id) ?? range);
      // Only report actual changes (guards against update loops).
      options.onPositionsChanged?.(options.documentPath, mapping.updates);
    }
  });

  const events = EditorView.domEventHandlers({
    mouseup(_event, view) {
      options.onMouseUpSelection?.(view);
      return false;
    },
    mousemove(event, view) {
      options.onMouseMove?.(event, view);
      return false;
    }
  });

  // `@uiw` basic-setup binds Mod-Shift-m to openLintPanel via lintKeymap; the
  // EditorPane disables it (basicSetup.lintKeymap: false) and this binding is
  // registered at high precedence as a belt-and-braces guard.
  const commentKeymap = Prec.high(
    keymap.of([
      {
        key: "Mod-Shift-m",
        run: (view) => options.onCommentShortcut?.(view) ?? false
      },
      {
        key: "Mod-Shift-j",
        run: (view) => options.onTightenShortcut?.(view) ?? false
      },
      {
        key: "Escape",
        run: (view) => options.onEscape?.(view) ?? false
      }
    ])
  );

  return [decorations, EditorView.decorations.from(decorations), listener, events, commentKeymap];
}
