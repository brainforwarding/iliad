import { Prec } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { WritingIssue } from "./issues";
import { rangeIntersectsAny, wordRangeAt } from "../writingAssistContext";

export interface WritingCorrectorLabels {
  openActions: string;
}

export interface WritingCorrectorExtensionOptions {
  enabled: boolean;
  issues?: readonly WritingIssue[];
  onOpenIssue?: (issue: WritingIssue, view: EditorView) => void;
}

function buildDecorations(
  issues: readonly WritingIssue[],
  currentWordRange: { from: number; to: number } | null = null
): DecorationSet {
  const visibleIssues = currentWordRange
    ? issues.filter((issue) => !rangeIntersectsAny({ from: issue.from, to: issue.to }, [currentWordRange]))
    : issues;

  return Decoration.set(
    visibleIssues.map((issue) =>
      Decoration.mark({
        class: "cm-writing-corrector-mark",
        attributes: {
          "data-writing-issue-id": issue.id,
          "aria-label": issue.message
        }
      }).range(issue.from, issue.to)
    ),
    true
  );
}

export function buildWritingCorrectorDecorations(issues: readonly WritingIssue[]) {
  return buildDecorations(issues);
}

export function writingCorrectorExtension(options: WritingCorrectorExtensionOptions) {
  const plugin = ViewPlugin.fromClass(
    class WritingCorrectorPlugin {
      issues: WritingIssue[];
      decorations: DecorationSet;
      private composing = false;

      constructor(private readonly view: EditorView) {
        this.issues = this.visibleIssues();
        this.decorations = buildDecorations(this.issues, this.currentWordRange(view));
      }

      update(update: ViewUpdate) {
        if (update.transactions.some((transaction) => transaction.isUserEvent("input.type.compose"))) {
          this.composing = true;
        }

        this.issues = update.docChanged ? [] : this.visibleIssues();

        if (update.docChanged || update.selectionSet) {
          this.decorations = buildDecorations(this.issues, this.currentWordRange(update.view));
        }
      }

      setComposing(composing: boolean) {
        if (this.composing === composing) {
          return;
        }

        this.composing = composing;
        this.issues = this.visibleIssues();
        this.decorations = buildDecorations(this.issues, this.currentWordRange(this.view));
        this.view.dispatch({});
      }

      openIssueAtCursor() {
        const selection = this.view.state.selection.main;
        const issue =
          this.issues.find((candidate) => selection.from >= candidate.from && selection.from <= candidate.to) ??
          this.issues.find((candidate) => candidate.from >= selection.from);

        if (!issue) {
          return false;
        }

        options.onOpenIssue?.(issue, this.view);
        return true;
      }

      issueById(id: string) {
        return this.issues.find((issue) => issue.id === id) ?? null;
      }

      issueAtPosition(position: number) {
        return this.issues.find((issue) => position >= issue.from && position <= issue.to) ?? null;
      }

      private visibleIssues() {
        if (!options.enabled || this.composing) {
          return [];
        }

        return [...(options.issues ?? [])];
      }

      private currentWordRange(view: EditorView) {
        const selection = view.state.selection.main;

        if (!selection.empty) {
          return null;
        }

        const line = view.state.doc.lineAt(selection.head);
        const range = wordRangeAt(line.text, selection.head - line.from);

        return range ? { from: line.from + range.from, to: line.from + range.to } : null;
      }
    },
    {
      decorations: (value) => value.decorations,
      eventHandlers: {
        compositionstart(_event, view) {
          view.plugin(plugin)?.setComposing(true);
        },
        compositionend(_event, view) {
          view.plugin(plugin)?.setComposing(false);
        },
        mousedown(event, view) {
          const target = event.target instanceof Element ? event.target.closest(".cm-writing-corrector-mark") : null;

          if (!target) {
            return false;
          }

          const issueId = target.getAttribute("data-writing-issue-id");
          const issue =
            (issueId ? view.plugin(plugin)?.issueById(issueId) : null) ??
            view.plugin(plugin)?.issueAtPosition(view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? -1);

          if (!issue) {
            return false;
          }

          event.preventDefault();
          options.onOpenIssue?.(issue, view);
          return true;
        }
      }
    }
  );

  return [
    plugin,
    Prec.high(
      keymap.of([
        {
          key: "Mod-.",
          run: (view) => view.plugin(plugin)?.openIssueAtCursor() ?? false
        }
      ])
    )
  ];
}
