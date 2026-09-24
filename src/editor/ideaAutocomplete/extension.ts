import { Prec, StateEffect } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { buildAutocompleteContext, type BlockedLineRange } from "../writingAssistContext";
import type { IdeaAutocompleteFailureReason, IdeaAutocompleteResult } from "../../types/iliad";
import { defaultAutocompletePreferences, selectWritingGuidance, type AutocompletePreferences, type WritingGuidance } from "./options";
import { recordAutocompleteMetric } from "./metrics";

export type IdeaAutocompleteTrigger = "automatic" | "manual";
export type IdeaAutocompleteSuggestionKind = "inline" | "sentence" | "paragraph" | "idea";

/** Pressing the continue key on a visible suggestion grows it one step. */
export function nextAutocompleteKind(kind: IdeaAutocompleteSuggestionKind): IdeaAutocompleteSuggestionKind | null {
  return kind === "inline" ? "sentence" : kind === "sentence" ? "paragraph" : kind === "paragraph" ? "idea" : null;
}

/** Mirrors the main-process prefix cap; the visible draft is appended to the document prefix. */
export const AUTOCOMPLETE_MODEL_PREFIX_MAX_CHARS = 2500;

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
  /** The prefix ends with the visible, unaccepted suggestion, which the model continues. */
  extend?: boolean;
}

export interface IdeaAutocompleteExtensionOptions {
  preferences?: AutocompletePreferences;
  guidance?: WritingGuidance;
  snoozedUntil?: number;
  onPartial?: (listener: (event: { requestId: string; insert: string }) => void) => () => void;
  enabled: boolean;
  /** False when no AI key is set: only explicit (manual) requests run, and they report the missing key. */
  automaticEnabled?: boolean;
  language: "en" | "es";
  workspaceSessionId?: string;
  documentRelativePath?: string;
  documentTitle: string;
  blockedLineRanges?: readonly BlockedLineRange[];
  requestAutocomplete: (request: IdeaAutocompleteRequestPayload) => Promise<IdeaAutocompleteResult>;
  cancelAutocomplete: (requestId: string) => void;
  onStatusChange?: (status: IdeaAutocompleteStatus) => void;
}

export type IdeaAutocompleteStatus =
  | { state: "idle" }
  | { state: "requesting" }
  | { state: "shown"; insert?: string; streaming?: boolean; kind?: IdeaAutocompleteSuggestionKind; alternativeIndex?: number; alternativeCount?: number }
  | { state: "failed"; reason: IdeaAutocompleteFailureReason };

interface ActiveSuggestion {
  requestId: string;
  from: number;
  insert: string;
  prefix: string;
  suffix: string;
}

const refreshAutocompleteEffect = StateEffect.define<void>();
export type AutocompleteAction = { kind: IdeaAutocompleteSuggestionKind; direction?: string } | "longer" | "previous" | "next" | "new" | "accept" | "dismiss";
const controllers = new WeakMap<EditorView, { action(action: AutocompleteAction): boolean }>();
export function runAutocompleteAction(view: EditorView, action: AutocompleteAction) {
  return controllers.get(view)?.action(action) ?? false;
}
export const ideaAutocompleteDebounceMs = 450;
export const ideaAutocompleteManualKey = "Mod-Enter";
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

  // An Idea spans paragraphs; CodeMirror must know the widget's line breaks to measure its height.
  get lineBreaks() {
    return this.text.split("\n").length - 1;
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
      private requestBase = "";
      private requestKind: IdeaAutocompleteSuggestionKind = "sentence";
      private inFlightTrigger: IdeaAutocompleteTrigger | null = null;
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
          const insert = this.requestBase + event.insert;
          if (this.suggestion && !insert.startsWith(this.suggestion.insert)) return;
          this.suggestion = { requestId: event.requestId, ...this.requestContext, insert };
          this.renderSuggestion(true);
        });
      }

      action(action: AutocompleteAction) {
        if (typeof action === "object") return this.triggerManual(action.kind, action.direction ?? "");
        if (action === "accept") return this.accept();
        if (action === "dismiss") return this.dismiss();
        if (action === "longer") return this.extend();
        if (action === "new") return this.triggerManual(this.lastKind, this.direction);
        if (!this.suggestion || this.inFlightRequestId) return false;
        // Past the last cached alternative, "next" asks for a fresh one.
        if (action === "next" && this.variantIndex >= this.variants.length - 1) return this.triggerManual(this.lastKind, this.direction);
        if (this.variants.length < 2) return false;
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
        this.setStatus({ state: "shown", insert: this.suggestion?.insert, streaming, kind: streaming ? this.requestKind : this.lastKind,
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
            this.setStatus({ state: "shown", insert: remaining.insert, kind: this.lastKind });
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

      accept() {
        const selection = this.view.state.selection.main;

        if (!this.suggestion || this.composing || this.view.state.selection.ranges.length !== 1 || !selection.empty || selection.from !== this.suggestion.from) {
          return false;
        }

        const original = this.suggestion;
        recordAutocompleteMetric("accepted");
        const insert = original.insert;
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

      /**
       * The single AI key with nothing selected: suggest a sentence, or grow the
       * visible suggestion. With a selection it falls through to the selection AI menu.
       */
      continueKey() {
        const selection = this.view.state.selection;
        // A selection belongs to the selection AI menu (registered first). If it
        // could not take the key, still never let the AI key edit the document.
        if (selection.ranges.length !== 1 || !selection.main.empty) return true;
        if (this.composing) return false;
        if (this.suggestion && selection.main.from === this.suggestion.from) return this.extend() || true;
        if (this.inFlightRequestId && this.inFlightTrigger === "manual") return true;
        this.triggerManual("sentence", "");
        // Swallow the key while autocomplete is on so a busy or cooling-down
        // provider never turns the AI key into an unexpected blank line.
        return true;
      }

      /**
       * A direct length key: one request for exactly that length. A visible,
       * shorter suggestion is extended (only the missing part is generated);
       * otherwise a fresh suggestion of that length is requested.
       */
      lengthKey(kind: IdeaAutocompleteSuggestionKind) {
        const selection = this.view.state.selection;
        // Length keys only ever write new text; over a selection they do nothing
        // (and never fall through to defaults such as toggleComment on Mod-/).
        if (selection.ranges.length !== 1 || !selection.main.empty) return true;
        if (this.composing) return false;
        if (this.inFlightRequestId && this.inFlightTrigger === "manual") {
          if (this.requestKind === kind) return true;
          // Switch lengths mid-request: keep an accepted-looking base draft, drop a partial fresh one.
          const base = this.requestBase;
          this.cancelInFlight();
          this.suggestion = base && this.suggestion ? { ...this.suggestion, insert: base } : null;
          this.view.dispatch({ effects: refreshAutocompleteEffect.of(undefined) });
        }
        const order: IdeaAutocompleteSuggestionKind[] = ["inline", "sentence", "paragraph", "idea"];
        if (this.suggestion && selection.main.from === this.suggestion.from && order.indexOf(kind) > order.indexOf(this.lastKind)) {
          return this.extend(kind) || true;
        }
        this.triggerManual(kind, "");
        return true;
      }

      /** Continue the visible suggestion (one length further by default), keeping what is shown. */
      extend(target?: IdeaAutocompleteSuggestionKind) {
        const current = this.suggestion;
        const selection = this.view.state.selection;
        const next = target ?? nextAutocompleteKind(this.lastKind);
        if (!current || !next || this.composing || this.inFlightRequestId || selection.ranges.length !== 1 ||
            !selection.main.empty || selection.main.from !== current.from || !this.canRequest("manual", true)) return false;
        this.clearTimer();
        this.pendingAutomaticTrigger = false;
        void this.requestSuggestion("manual", next, current.insert);
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

      private canRequest(trigger: IdeaAutocompleteTrigger, extending = false) {
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

        if (trigger === "automatic" && (options.automaticEnabled === false || options.preferences?.manualOnly || Date.now() < (options.snoozedUntil ?? 0) || !this.pendingAutomaticTrigger || this.dismissedUntilEdit || Date.now() < this.automaticPausedUntil)) {
          return false;
        }

        const selection = this.view.state.selection.main;

        if (this.view.state.selection.ranges.length !== 1 || !selection.empty || this.inFlightRequestId || (this.suggestion && !extending)) {
          return false;
        }

        return true;
      }

      private async requestSuggestion(trigger: IdeaAutocompleteTrigger, requestedKind?: IdeaAutocompleteSuggestionKind, base = "") {
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
        this.direction = direction;
        const guidance = selectWritingGuidance(options.guidance, `${context.prefix.slice(-700)} ${context.headingPath.join(" ")}`);
        // Extended drafts and fresh suggestions are not comparable alternatives.
        const variantKey = JSON.stringify([selection.from, context, suggestionKind, direction, guidance, base]);
        const previousVariants = variantKey === this.variantKey ? this.variants : [];
        if (variantKey !== this.variantKey) {
          this.variants = [];
          this.variantKey = variantKey;
        }
        // Stale checks always compare document context; the model additionally
        // sees the visible draft it is asked to continue.
        this.requestContext = { from: selection.from, prefix: context.prefix, suffix: context.suffix };
        this.requestBase = base;
        this.requestKind = suggestionKind;
        const modelPrefix = base ? (context.prefix + base).slice(-AUTOCOMPLETE_MODEL_PREFIX_MAX_CHARS) : context.prefix;
        this.requestStartedAt = trigger === "automatic" && this.lastEditAt ? this.lastEditAt : Date.now();
        this.measuredVisible = false;
        recordAutocompleteMetric("requested");
        this.inFlightRequestId = requestId;
        this.inFlightTrigger = trigger;
        this.pendingAutomaticTrigger = false;
        this.setStatus({ state: "requesting" });

        try {
          const result = await options.requestAutocomplete({
            requestId,
            workspaceSessionId: options.workspaceSessionId,
            documentRelativePath: options.documentRelativePath,
            language: options.language,
            cursor: selection.from,
            prefix: modelPrefix,
            suffix: context.suffix,
            headingPath: context.headingPath,
            documentTitle: options.documentTitle,
            nearbyHeadings: context.nearbyHeadings,
            trigger,
            suggestionKind,
            extend: Boolean(base),
            direction,
            guidance,
            avoid: trigger === "manual" && !base ? previousVariants : []
          });

          if (this.inFlightRequestId !== requestId) {
            return;
          }

          this.inFlightRequestId = null;

          if (!result.ok) {
            if (result.reason === "timeout") recordAutocompleteMetric("timeouts");
            // A failed extension leaves the visible draft, and its controls, exactly as they were.
            this.suggestion = base && this.suggestion ? { ...this.suggestion, insert: base } : null;
            this.view.dispatch({ effects: refreshAutocompleteEffect.of(undefined) });
            if (this.suggestion) {
              const cooldownMs = autocompleteCooldownMsForFailure(result.reason);
              if (cooldownMs > 0) this.cooldownUntil = applySharedAutocompleteCooldown(result.reason);
              this.renderSuggestion();
              return;
            }
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

          const full = base + result.insert;
          // Never rewrite a visible streamed prefix underneath the writer.
          if (this.suggestion && !full.startsWith(this.suggestion.insert)) {
            this.suggestion = null;
            this.view.dispatch({ effects: refreshAutocompleteEffect.of(undefined) });
            this.setStatus({ state: "failed", reason: "no_suggestion" });
            return;
          }
          this.suggestion = {
            requestId,
            from: selection.from,
            insert: full,
            prefix: context.prefix,
            suffix: context.suffix
          };
          if (!this.variants.includes(full)) this.variants = [...this.variants.slice(-2), full];
          this.variantIndex = this.variants.indexOf(full);
          this.lastKind = suggestionKind;
          this.renderSuggestion();
        } catch {
          if (this.inFlightRequestId !== requestId) return;
          this.inFlightRequestId = null;
          this.suggestion = base && this.suggestion ? { ...this.suggestion, insert: base } : null;
          this.view.dispatch({ effects: refreshAutocompleteEffect.of(undefined) });

          this.cooldownUntil = applySharedAutocompleteCooldown("provider");
          if (this.suggestion) {
            this.renderSuggestion();
            return;
          }
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
        this.inFlightTrigger = null;
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

  // Fall back per key: preferences held in memory from an older shape may lack the length keys.
  const lengthKeys = { ...defaultAutocompletePreferences.shortcuts, ...options.preferences?.shortcuts };
  return [
    plugin,
    // Direct length keys outrank other editor bindings on the same keys (e.g. the
    // corrector's Mod-. or CodeMirror's Mod-/ comment toggle); users can remap them.
    Prec.highest(
      keymap.of((["sentence", "paragraph", "idea"] as const).map((kind) => ({
        key: lengthKeys[kind],
        run: (view: EditorView) => view.plugin(plugin)?.lengthKey(kind) ?? false
      })))
    ),
    Prec.high(
      keymap.of([
        {
          key: "Tab",
          run: (view) => view.plugin(plugin)?.accept() ?? false
        },
        {
          key: "Escape",
          run: (view) => view.plugin(plugin)?.dismiss() ?? false
        },
        {
          key: options.preferences?.shortcuts.continue ?? ideaAutocompleteManualKey,
          run: (view) => view.plugin(plugin)?.continueKey() ?? false
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
