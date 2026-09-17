import { Prec, StateEffect } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { buildAutocompleteContext, type BlockedLineRange } from "../writingAssistContext";
import type { IdeaAutocompleteFailureReason, IdeaAutocompleteResult } from "../../types/iliad";

export type IdeaAutocompleteTrigger = "automatic" | "manual";
export type IdeaAutocompleteSuggestionKind = "inline" | "sentence" | "paragraph";

export interface IdeaAutocompleteRequestPayload {
  requestId: string;
  workspaceSessionId: string;
  documentRelativePath: string;
  language: "en" | "es";
  cursor: number;
  prefix: string;
  suffix: string;
  headingPath: string[];
  documentTitle: string;
  nearbyHeadings: string[];
  trigger: IdeaAutocompleteTrigger;
  suggestionKind: IdeaAutocompleteSuggestionKind;
  autocompleteApiFallbackEnabled: boolean;
}

export interface IdeaAutocompleteExtensionOptions {
  enabled: boolean;
  language: "en" | "es";
  workspaceSessionId?: string;
  documentRelativePath?: string;
  documentTitle: string;
  autocompleteApiFallbackEnabled: boolean;
  blockedLineRanges?: readonly BlockedLineRange[];
  requestAutocomplete: (request: IdeaAutocompleteRequestPayload) => Promise<IdeaAutocompleteResult>;
  cancelAutocomplete: (requestId: string) => void;
  onStatusChange?: (status: IdeaAutocompleteStatus) => void;
}

export type IdeaAutocompleteStatus =
  | { state: "idle" }
  | { state: "requesting" }
  | { state: "shown" }
  | { state: "failed"; reason: IdeaAutocompleteFailureReason };

interface ActiveSuggestion {
  requestId: string;
  from: number;
  insert: string;
  prefix: string;
  suffix: string;
}

const refreshAutocompleteEffect = StateEffect.define<void>();
export const ideaAutocompleteDebounceMs = 450;
export const ideaAutocompleteManualKey = "Mod-Enter";
export const ideaAutocompleteFallbackManualKey = "Ctrl-Space";
export const ideaAutocompleteParagraphKey = "Mod-Shift-Enter";
export const ideaAutocompleteAcceptWordKey = "Alt-ArrowRight";
const transientProviderCooldownMs = 15_000;
const rateLimitCooldownMs = 60_000;
let requestSequence = 0;
let sharedCooldownUntil = 0;

interface AutocompleteTransactionLike {
  docChanged: boolean;
  isUserEvent: (event: string) => boolean;
}

export function autocompleteCooldownMsForFailure(reason: IdeaAutocompleteFailureReason) {
  switch (reason) {
    case "rate_limited":
      return rateLimitCooldownMs;
    case "provider":
    case "timeout":
      return transientProviderCooldownMs;
    default:
      return 0;
  }
}

export function applySharedAutocompleteCooldown(reason: IdeaAutocompleteFailureReason, now = Date.now()) {
  const cooldownMs = autocompleteCooldownMsForFailure(reason);

  if (cooldownMs <= 0) {
    return sharedCooldownUntil;
  }

  sharedCooldownUntil = Math.max(sharedCooldownUntil, now + cooldownMs);
  return sharedCooldownUntil;
}

export function sharedAutocompleteCooldownActive(now = Date.now()) {
  return now < sharedCooldownUntil;
}

export function resetSharedAutocompleteCooldownForTests() {
  sharedCooldownUntil = 0;
}

export function isMeaningfulAutocompleteEditTransaction(transaction: AutocompleteTransactionLike) {
  return (
    transaction.docChanged &&
    (transaction.isUserEvent("input.type") ||
      transaction.isUserEvent("input.paste") ||
      transaction.isUserEvent("input.drop"))
  );
}

export function hasMeaningfulAutocompleteEdit(transactions: readonly AutocompleteTransactionLike[]) {
  return transactions.some((transaction) => isMeaningfulAutocompleteEditTransaction(transaction));
}

function lineBounds(text: string, cursor: number) {
  const position = Math.max(0, Math.min(text.length, Math.floor(cursor)));
  const lineStart = text.lastIndexOf("\n", Math.max(0, position - 1)) + 1;
  const nextBreak = text.indexOf("\n", position);
  const lineEnd = nextBreak >= 0 ? nextBreak : text.length;

  return {
    position,
    lineStart,
    lineEnd,
    before: text.slice(lineStart, position),
    after: text.slice(position, lineEnd)
  };
}

function previousNonEmptyLine(text: string, cursor: number) {
  const before = text.slice(0, Math.max(0, Math.min(text.length, Math.floor(cursor)))).replace(/[ \t]+$/g, "");
  const lines = before.split("\n");

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();

    if (line) {
      return line;
    }
  }

  return "";
}

function endsAtProseBoundary(text: string) {
  return /[.!?:;…]["')\]]?$/.test(text.trim());
}

export function isAutocompleteParagraphBoundary(text: string, cursor: number) {
  const { before, after } = lineBounds(text, cursor);

  if (after.trim()) {
    return false;
  }

  const line = before.trim();

  if (!line) {
    const previousLine = previousNonEmptyLine(text, cursor);
    return Boolean(previousLine) && (/^#{1,6}\s+\S/.test(previousLine) || endsAtProseBoundary(previousLine));
  }

  if (/^#{1,6}\s+\S/.test(line)) {
    return true;
  }

  if (/^(?:[-*+]|\d+[.)])\s+\S/.test(line)) {
    return endsAtProseBoundary(line);
  }

  return endsAtProseBoundary(line);
}

export function autocompleteSuggestionKindForTrigger(
  trigger: IdeaAutocompleteTrigger,
  _text: string,
  _cursor: number
): IdeaAutocompleteSuggestionKind {
  return trigger === "manual" ? "sentence" : "inline";
}

export function autocompleteWordPrefix(text: string) {
  return /^\s*\S+\s*/u.exec(text)?.[0] ?? text;
}

/** Only a pure insertion matching the ghost may consume it; edits elsewhere invalidate it. */
export function consumeAutocompleteSuggestion(
  suggestion: ActiveSuggestion,
  changes: readonly { from: number; to: number; insert: string }[],
  cursor: number
): ActiveSuggestion | null {
  if (changes.length !== 1) return null;
  const change = changes[0];
  if (change.from !== suggestion.from || change.to !== change.from || !change.insert ||
      !suggestion.insert.startsWith(change.insert) || cursor !== change.from + change.insert.length) return null;
  const remaining = suggestion.insert.slice(change.insert.length);
  return remaining ? { ...suggestion, from: cursor, insert: remaining, prefix: suggestion.prefix + change.insert } : null;
}

class GhostTextWidget extends WidgetType {
  constructor(private readonly text: string) {
    super();
  }

  toDOM() {
    const element = document.createElement("span");
    element.className = "cm-idea-autocomplete-ghost";
    element.textContent = this.text;
    element.setAttribute("aria-hidden", "true");
    element.setAttribute("contenteditable", "false");
    return element;
  }

  eq(other: GhostTextWidget) {
    return other.text === this.text;
  }

  ignoreEvent() {
    return true;
  }
}

function buildDecorations(suggestion: ActiveSuggestion | null): DecorationSet {
  if (!suggestion || !suggestion.insert) {
    return Decoration.none;
  }

  return Decoration.set([
    Decoration.widget({
      widget: new GhostTextWidget(suggestion.insert),
      side: 1
    }).range(suggestion.from)
  ]);
}

export function ideaAutocompleteExtension(options: IdeaAutocompleteExtensionOptions) {
  const plugin = ViewPlugin.fromClass(
    class IdeaAutocompletePlugin {
      suggestion: ActiveSuggestion | null = null;
      decorations = Decoration.none;
      private timer: number | null = null;
      private inFlightRequestId: string | null = null;
      private dismissedUntilEdit = false;
      private acceptedSuggestionChange = false;
      private pendingAutomaticTrigger = false;
      private composing = false;
      private cooldownUntil = 0;
      private automaticPausedUntil = 0;
      private dismissals: number[] = [];

      constructor(private readonly view: EditorView) {}

      update(update: ViewUpdate) {
        if (update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(refreshAutocompleteEffect)))) {
          this.decorations = buildDecorations(this.suggestion);
          return;
        }

        const meaningfulEdit = hasMeaningfulAutocompleteEdit(update.transactions);

        if (this.suggestion && update.docChanged && !this.composing && this.view.hasFocus &&
            update.state.selection.ranges.length === 1 && update.state.selection.main.empty &&
            update.transactions.every((transaction) => !transaction.docChanged || transaction.isUserEvent("input.type"))) {
          const changes: Array<{ from: number; to: number; insert: string }> = [];
          update.changes.iterChanges((from, to, _fromB, _toB, insert) => changes.push({ from, to, insert: insert.toString() }));
          const remaining = consumeAutocompleteSuggestion(this.suggestion, changes, update.state.selection.main.from);
          if (remaining) {
            this.suggestion = remaining;
            this.decorations = buildDecorations(remaining);
            return;
          }
        }

        if (update.docChanged || update.selectionSet || update.focusChanged) {
          this.clearTimer();
          this.clearSuggestion();
        }

        if (update.docChanged) {
          if (this.acceptedSuggestionChange) {
            this.acceptedSuggestionChange = false;
            this.pendingAutomaticTrigger = false;
          } else if (meaningfulEdit) {
            this.dismissedUntilEdit = false;
            this.pendingAutomaticTrigger = true;
            this.schedule("automatic");
            return;
          } else {
            this.pendingAutomaticTrigger = false;
          }
        }

        if (update.selectionSet || update.focusChanged) {
          this.pendingAutomaticTrigger = false;
          this.dismissedUntilEdit = true;
        }
      }

      destroy() {
        this.clearTimer();
        this.cancelInFlight();
      }

      setComposing(composing: boolean) {
        this.composing = composing;
        this.clearTimer();
        this.clearSuggestion();
        this.pendingAutomaticTrigger = false;
      }

      accept(wordOnly = false) {
        const selection = this.view.state.selection.main;

        if (!this.suggestion || this.composing || this.view.state.selection.ranges.length !== 1 || !selection.empty || selection.from !== this.suggestion.from) {
          return false;
        }

        const original = this.suggestion;
        const insert = wordOnly ? autocompleteWordPrefix(original.insert) : original.insert;
        this.clearTimer();
        this.clearSuggestion();
        this.dismissedUntilEdit = true;
        this.acceptedSuggestionChange = true;
        this.view.dispatch({
          changes: { from: selection.from, insert },
          selection: { anchor: selection.from + insert.length },
          annotations: isolateHistory.of("full"),
          userEvent: "input.complete"
        });
        if (insert.length < original.insert.length) {
          this.suggestion = { ...original, from: selection.from + insert.length,
            insert: original.insert.slice(insert.length), prefix: original.prefix + insert };
          this.view.dispatch({ effects: refreshAutocompleteEffect.of(undefined) });
          this.setStatus({ state: "shown" });
          return true;
        }
        this.setStatus({ state: "idle" });
        return true;
      }

      dismiss() {
        if (!this.suggestion && !this.inFlightRequestId && this.timer === null) {
          return false;
        }

        this.registerDismissal();
        this.clearTimer();
        this.clearSuggestion();
        this.dismissedUntilEdit = true;
        this.setStatus({ state: "idle" });
        return true;
      }

      triggerManual(kind: IdeaAutocompleteSuggestionKind = "sentence") {
        this.clearTimer();
        this.clearSuggestion();
        this.pendingAutomaticTrigger = false;

        if (!this.canRequest("manual")) {
          return false;
        }

        void this.requestSuggestion("manual", kind);
        return true;
      }

      private schedule(trigger: IdeaAutocompleteTrigger) {
        this.clearTimer();

        if (!this.canRequest(trigger)) {
          return;
        }

        this.timer = window.setTimeout(() => {
          this.timer = null;
          if (this.canRequest(trigger)) void this.requestSuggestion(trigger);
        }, ideaAutocompleteDebounceMs);
      }

      private canRequest(trigger: IdeaAutocompleteTrigger) {
        if (
          !options.enabled ||
          !options.workspaceSessionId ||
          !options.documentRelativePath ||
          this.composing ||
          Date.now() < this.cooldownUntil ||
          sharedAutocompleteCooldownActive() ||
          !this.view.hasFocus
        ) {
          return false;
        }

        if (trigger === "automatic" && (!this.pendingAutomaticTrigger || this.dismissedUntilEdit || Date.now() < this.automaticPausedUntil)) {
          return false;
        }

        const selection = this.view.state.selection.main;

        if (this.view.state.selection.ranges.length !== 1 || !selection.empty || this.inFlightRequestId || this.suggestion) {
          return false;
        }

        return true;
      }

      private async requestSuggestion(trigger: IdeaAutocompleteTrigger, requestedKind?: IdeaAutocompleteSuggestionKind) {
        const selection = this.view.state.selection.main;

        if (!selection.empty || !options.workspaceSessionId || !options.documentRelativePath) {
          return;
        }

        const text = this.view.state.doc.toString();
        const suggestionKind = requestedKind ?? autocompleteSuggestionKindForTrigger(trigger, text, selection.from);
        // Pause at word boundaries so a suggestion cannot split a word being typed.
        if (trigger === "automatic" && /[\p{L}\p{N}]$/u.test(text.slice(0, selection.from))) return;
        const context = buildAutocompleteContext(text, selection.from, {
          minPrefixChars: trigger === "manual" ? 8 : 20,
          includePreviousBlockOnEmptyPrefix: trigger === "manual",
          includePreviousBlockOnShortPrefix: true,
          blockedLineRanges: options.blockedLineRanges
        });

        if (!context) {
          this.setStatus({ state: "idle" });
          return;
        }

        const requestId = `idea-autocomplete-${Date.now()}-${++requestSequence}`;
        this.inFlightRequestId = requestId;
        this.pendingAutomaticTrigger = false;
        this.setStatus({ state: "requesting" });

        try {
          const result = await options.requestAutocomplete({
            requestId,
            workspaceSessionId: options.workspaceSessionId,
            documentRelativePath: options.documentRelativePath,
            language: options.language,
            cursor: selection.from,
            prefix: context.prefix,
            suffix: context.suffix,
            headingPath: context.headingPath,
            documentTitle: options.documentTitle,
            nearbyHeadings: context.nearbyHeadings,
            trigger,
            suggestionKind,
            autocompleteApiFallbackEnabled: options.autocompleteApiFallbackEnabled
          });

          if (this.inFlightRequestId !== requestId) {
            return;
          }

          this.inFlightRequestId = null;

          if (!result.ok) {
            const cooldownMs = autocompleteCooldownMsForFailure(result.reason);
            if (cooldownMs > 0) {
              this.cooldownUntil = applySharedAutocompleteCooldown(result.reason);
            }

            if (result.reason !== "aborted") {
              this.setStatus({ state: "failed", reason: result.reason });
            }

            return;
          }

          const latestSelection = this.view.state.selection.main;
          const latestContext = buildAutocompleteContext(this.view.state.doc.toString(), latestSelection.from, {
            minPrefixChars: trigger === "manual" ? 8 : 20,
            includePreviousBlockOnEmptyPrefix: trigger === "manual",
            includePreviousBlockOnShortPrefix: true,
            blockedLineRanges: options.blockedLineRanges
          });

          if (
            !latestSelection.empty ||
            latestSelection.from !== selection.from ||
            !latestContext ||
            latestContext.prefix !== context.prefix ||
            latestContext.suffix !== context.suffix
          ) {
            return;
          }

          this.suggestion = {
            requestId,
            from: selection.from,
            insert: result.insert,
            prefix: context.prefix,
            suffix: context.suffix
          };
          this.decorations = buildDecorations(this.suggestion);
          this.view.dispatch({ effects: refreshAutocompleteEffect.of(undefined) });
          this.setStatus({ state: "shown" });
        } catch {
          if (this.inFlightRequestId !== requestId) return;
          this.inFlightRequestId = null;

          this.cooldownUntil = applySharedAutocompleteCooldown("provider");
          this.setStatus({ state: "failed", reason: "provider" });
        }
      }

      private clearSuggestion() {
        if (!this.suggestion) {
          this.cancelInFlight();
          this.setStatus({ state: "idle" });
          return;
        }

        this.suggestion = null;
        this.decorations = buildDecorations(null);
        this.cancelInFlight();
        this.setStatus({ state: "idle" });
      }

      private cancelInFlight() {
        if (!this.inFlightRequestId) {
          return;
        }

        options.cancelAutocomplete(this.inFlightRequestId);
        this.inFlightRequestId = null;
      }

      private clearTimer() {
        if (this.timer === null) {
          return;
        }

        window.clearTimeout(this.timer);
        this.timer = null;
      }

      private registerDismissal() {
        const now = Date.now();
        this.dismissals = this.dismissals.filter((timestamp) => now - timestamp < 60_000);
        this.dismissals.push(now);

        if (this.dismissals.length >= 3) {
          this.automaticPausedUntil = now + 5 * 60_000;
          this.dismissals = [];
        }
      }

      private setStatus(status: IdeaAutocompleteStatus) {
        options.onStatusChange?.(status);
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
        }
      }
    }
  );

  return [
    plugin,
    Prec.high(
      keymap.of([
        {
          key: "Tab",
          run: (view) => view.plugin(plugin)?.accept() ?? false
        },
        {
          key: ideaAutocompleteAcceptWordKey,
          run: (view) => view.plugin(plugin)?.accept(true) ?? false
        },
        {
          key: "Escape",
          run: (view) => view.plugin(plugin)?.dismiss() ?? false
        },
        {
          key: ideaAutocompleteManualKey,
          run: (view) => view.plugin(plugin)?.triggerManual() ?? false
        },
        {
          key: ideaAutocompleteFallbackManualKey,
          run: (view) => view.plugin(plugin)?.triggerManual("inline") ?? false
        },
        {
          key: ideaAutocompleteParagraphKey,
          run: (view) => view.plugin(plugin)?.triggerManual("paragraph") ?? false
        }
      ])
    )
  ];
}
