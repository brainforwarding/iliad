import { Prec, StateEffect } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { buildAutocompleteContext, type BlockedLineRange } from "../writingAssistContext";
import type { IdeaAutocompleteFailureReason, IdeaAutocompleteResult } from "../../types/iliad";
import { selectWritingGuidance, type AutocompletePreferences, type WritingGuidance } from "./options";
import { recordAutocompleteMetric } from "./metrics";

export type IdeaAutocompleteTrigger = "automatic" | "manual";
export type IdeaAutocompleteSuggestionKind = "inline" | "sentence" | "paragraph";

export interface IdeaAutocompleteRequestPayload {
  direction?: string;
  guidance?: string;
  avoid?: string[];
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
  preferences?: AutocompletePreferences;
  guidance?: WritingGuidance;
  snoozedUntil?: number;
  onPartial?: (listener: (event: { requestId: string; insert: string }) => void) => () => void;
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
  | { state: "shown"; insert?: string; streaming?: boolean; alternativeIndex?: number; alternativeCount?: number }
  | { state: "failed"; reason: IdeaAutocompleteFailureReason };

interface ActiveSuggestion {
  requestId: string;
  from: number;
  insert: string;
  prefix: string;
  suffix: string;
}

const refreshAutocompleteEffect = StateEffect.define<void>();
export type AutocompleteAction = { kind: IdeaAutocompleteSuggestionKind; direction?: string } | "previous" | "next" | "new" | "accept" | "dismiss";
const controllers = new WeakMap<EditorView, { action(action: AutocompleteAction): boolean }>();
export function runAutocompleteAction(view: EditorView, action: AutocompleteAction) {
  return controllers.get(view)?.action(action) ?? false;
}
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
      private unsubscribePartial?: () => void;
      private variants: string[] = [];
      private variantIndex = 0;
      private variantKey = "";
      private lastKind: IdeaAutocompleteSuggestionKind = "sentence";
      private direction = "";
      private requestContext: { from: number; prefix: string; suffix: string } | null = null;
      private requestStartedAt = 0;
      private lastEditAt = 0;
      private measuredVisible = false;
      private lastEditAccepted = false;

      constructor(private readonly view: EditorView) {
        controllers.set(view, this);
        this.unsubscribePartial = options.onPartial?.((event) => {
          if (event.requestId !== this.inFlightRequestId || !this.requestContext || !this.view.hasFocus || this.composing) return;
          const selection = this.view.state.selection;
          if (selection.ranges.length !== 1 || !selection.main.empty || selection.main.from !== this.requestContext.from) return;
          if (this.suggestion && !event.insert.startsWith(this.suggestion.insert)) return;
          this.suggestion = { requestId: event.requestId, ...this.requestContext, insert: event.insert };
          this.renderSuggestion(true);
        });
      }

      action(action: AutocompleteAction) {
        if (typeof action === "object") return this.triggerManual(action.kind, action.direction ?? "");
        if (action === "accept") return this.accept();
        if (action === "dismiss") return this.dismiss();
        if (action === "new") return this.triggerManual(this.lastKind, this.direction);
        if (!this.suggestion || this.variants.length < 2 || this.inFlightRequestId) return false;
        this.variantIndex = (this.variantIndex + (action === "previous" ? -1 : 1) + this.variants.length) % this.variants.length;
        this.suggestion = { ...this.suggestion, insert: this.variants[this.variantIndex] };
        this.renderSuggestion();
        return true;
      }

      private renderSuggestion(streaming = false) {
        if (!this.measuredVisible && this.requestStartedAt) {
          recordAutocompleteMetric("shown", Date.now() - this.requestStartedAt);
          this.measuredVisible = true;
        }
        this.view.dispatch({ effects: refreshAutocompleteEffect.of(undefined) });
        this.setStatus({ state: "shown", insert: this.suggestion?.insert, streaming,
          alternativeIndex: this.variantIndex, alternativeCount: this.variants.length });
      }

      update(update: ViewUpdate) {
        if (update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(refreshAutocompleteEffect)))) {
          this.decorations = buildDecorations(this.suggestion);
          return;
        }

        const meaningfulEdit = hasMeaningfulAutocompleteEdit(update.transactions);
        if (update.docChanged) {
          if (this.lastEditAccepted && update.transactions.some((transaction) => transaction.isUserEvent("undo"))) recordAutocompleteMetric("undone");
          this.lastEditAccepted = this.acceptedSuggestionChange;
          if (meaningfulEdit) this.lastEditAt = Date.now();
        }
        if (update.docChanged || update.selectionSet) {
          this.variants = [];
          this.variantKey = "";
        }

        if (this.suggestion && update.docChanged && !this.composing && this.view.hasFocus &&
            update.state.selection.ranges.length === 1 && update.state.selection.main.empty &&
            update.transactions.every((transaction) => !transaction.docChanged || transaction.isUserEvent("input.type"))) {
          const changes: Array<{ from: number; to: number; insert: string }> = [];
          update.changes.iterChanges((from, to, _fromB, _toB, insert) => changes.push({ from, to, insert: insert.toString() }));
          const remaining = consumeAutocompleteSuggestion(this.suggestion, changes, update.state.selection.main.from);
          if (remaining) {
            this.cancelInFlight();
            this.suggestion = remaining;
            this.decorations = buildDecorations(remaining);
            this.setStatus({ state: "shown", insert: remaining.insert });
            return;
          }
        }

        const lostFocus = update.focusChanged && !this.view.hasFocus;
        if (update.docChanged || update.selectionSet || lostFocus) {
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

        if (update.selectionSet || lostFocus) {
          this.pendingAutomaticTrigger = false;
          this.dismissedUntilEdit = true;
        }
      }

      destroy() {
        controllers.delete(this.view);
        this.unsubscribePartial?.();
        this.clearTimer();
        this.cancelInFlight();
        this.setStatus({ state: "idle" });
      }

      setComposing(composing: boolean) {
        this.composing = composing;
        this.clearTimer();
        this.clearSuggestion();
        this.pendingAutomaticTrigger = false;
        this.view.dispatch({ effects: refreshAutocompleteEffect.of(undefined) });
      }

      accept(wordOnly = false) {
        const selection = this.view.state.selection.main;

        if (!this.suggestion || this.composing || this.view.state.selection.ranges.length !== 1 || !selection.empty || selection.from !== this.suggestion.from) {
          return false;
        }

        const original = this.suggestion;
        recordAutocompleteMetric(wordOnly ? "wordsAccepted" : "accepted");
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
          this.renderSuggestion();
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
        this.view.dispatch({ effects: refreshAutocompleteEffect.of(undefined) });
        this.dismissedUntilEdit = true;
        this.setStatus({ state: "idle" });
        return true;
      }

      triggerManual(kind: IdeaAutocompleteSuggestionKind = "sentence", direction = "") {
        this.lastKind = kind;
        this.direction = direction;
        this.clearTimer();
        this.clearSuggestion();
        this.view.dispatch({ effects: refreshAutocompleteEffect.of(undefined) });
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

        if (trigger === "automatic" && (options.preferences?.manualOnly || Date.now() < (options.snoozedUntil ?? 0) || !this.pendingAutomaticTrigger || this.dismissedUntilEdit || Date.now() < this.automaticPausedUntil)) {
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
        const direction = trigger === "manual" ? this.direction : "";
        this.lastKind = suggestionKind;
        this.direction = direction;
        const guidance = selectWritingGuidance(options.guidance, `${context.prefix.slice(-700)} ${context.headingPath.join(" ")}`);
        const variantKey = JSON.stringify([selection.from, context, suggestionKind, direction, guidance]);
        if (variantKey !== this.variantKey) {
          this.variants = [];
          this.variantKey = variantKey;
        }
        this.requestContext = { from: selection.from, prefix: context.prefix, suffix: context.suffix };
        this.requestStartedAt = trigger === "automatic" && this.lastEditAt ? this.lastEditAt : Date.now();
        this.measuredVisible = false;
        recordAutocompleteMetric("requested");
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
            direction,
            guidance,
            avoid: trigger === "manual" ? this.variants : [],
            autocompleteApiFallbackEnabled: options.autocompleteApiFallbackEnabled
          });

          if (this.inFlightRequestId !== requestId) {
            return;
          }

          this.inFlightRequestId = null;

          if (!result.ok) {
            if (result.reason === "timeout") recordAutocompleteMetric("timeouts");
            this.suggestion = null;
            this.view.dispatch({ effects: refreshAutocompleteEffect.of(undefined) });
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

          // Never rewrite a visible streamed prefix underneath the writer.
          if (this.suggestion && !result.insert.startsWith(this.suggestion.insert)) {
            this.suggestion = null;
            this.view.dispatch({ effects: refreshAutocompleteEffect.of(undefined) });
            this.setStatus({ state: "failed", reason: "no_suggestion" });
            return;
          }
          this.suggestion = {
            requestId,
            from: selection.from,
            insert: result.insert,
            prefix: context.prefix,
            suffix: context.suffix
          };
          if (!this.variants.includes(result.insert)) this.variants = [...this.variants.slice(-2), result.insert];
          this.variantIndex = this.variants.indexOf(result.insert);
          this.lastKind = suggestionKind;
          this.renderSuggestion();
        } catch {
          if (this.inFlightRequestId !== requestId) return;
          this.inFlightRequestId = null;
          this.suggestion = null;
          this.view.dispatch({ effects: refreshAutocompleteEffect.of(undefined) });

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
          key: options.preferences?.shortcuts.sentence ?? ideaAutocompleteManualKey,
          run: (view) => view.plugin(plugin)?.triggerManual() ?? false
        },
        {
          key: options.preferences?.shortcuts.inline ?? ideaAutocompleteFallbackManualKey,
          run: (view) => view.plugin(plugin)?.triggerManual("inline") ?? false
        },
        {
          key: options.preferences?.shortcuts.paragraph ?? ideaAutocompleteParagraphKey,
          run: (view) => view.plugin(plugin)?.triggerManual("paragraph") ?? false
        },
        {
          key: "Alt-ArrowUp",
          run: (view) => view.plugin(plugin)?.action("previous") ?? false
        },
        {
          key: "Alt-ArrowDown",
          run: (view) => view.plugin(plugin)?.action("next") ?? false
        }
      ])
    )
  ];
}
