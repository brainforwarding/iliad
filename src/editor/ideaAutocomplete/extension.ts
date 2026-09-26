import { Prec, StateEffect } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { buildAutocompleteContext, type BlockedLineRange } from "../writingAssistContext";
import type { IdeaAutocompleteFailureReason, IdeaAutocompleteResult } from "../../types/iliad";
import { defaultAutocompletePreferences, type AutocompletePreferences } from "./options";
import { recordAutocompleteMetric } from "./metrics";

/**
 * Suggestions come only on request: the length keys (sentence, paragraph,
 * full idea), Longer, Another and Steer. Typing never sends a request
 * (spec 2026-09-25 writing assists one row).
 */
export type IdeaAutocompleteSuggestionKind = "sentence" | "paragraph" | "idea";

/** "Longer" on a visible suggestion grows it one step. */
export function nextAutocompleteKind(kind: IdeaAutocompleteSuggestionKind): IdeaAutocompleteSuggestionKind | null {
  return kind === "sentence" ? "paragraph" : kind === "paragraph" ? "idea" : null;
}

/** Mirrors the main-process prefix cap; the visible draft is appended to the document prefix. */
export const AUTOCOMPLETE_MODEL_PREFIX_MAX_CHARS = 2500;

export interface IdeaAutocompleteRequestPayload {
  direction?: string;
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
  suggestionKind: IdeaAutocompleteSuggestionKind;
  /** The prefix ends with the visible, unaccepted suggestion, which the model continues. */
  extend?: boolean;
}

export interface IdeaAutocompleteExtensionOptions {
  preferences?: AutocompletePreferences;
  onPartial?: (listener: (event: { requestId: string; insert: string }) => void) => () => void;
  enabled: boolean;
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
  /** `resetAt` (ISO 8601) comes with `free_exhausted`: the notice shows it as a local time. */
  | { state: "failed"; reason: IdeaAutocompleteFailureReason; resetAt?: string };

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
const transientProviderCooldownMs = 15_000;
const rateLimitCooldownMs = 60_000;
let requestSequence = 0;
let sharedCooldownUntil = 0;

export function autocompleteCooldownMsForFailure(reason: IdeaAutocompleteFailureReason) {
  switch (reason) {
    case "rate_limited":
      return rateLimitCooldownMs;
    case "provider":
    case "timeout":
      return transientProviderCooldownMs;
    // Free "out" reasons and the key/connection notices set no cooldown: every
    // request is explicit, so the next one reaches main again and, if still
    // refused, shows its notice again (Groq spec §5).
    case "free_exhausted":
    case "free_unavailable":
    case "client_outdated":
    case "key_unreadable":
    case "invalid_api_key":
    case "unreachable":
      return 0;
    default:
      return 0;
  }
}

/** Refusals that always show their notice, even over a visible draft. */
export function autocompleteFailureNeedsNotice(reason: IdeaAutocompleteFailureReason) {
  return reason === "free_exhausted" || reason === "free_unavailable" || reason === "client_outdated" ||
    reason === "key_unreadable" || reason === "invalid_api_key" || reason === "unreachable";
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
      private inFlightRequestId: string | null = null;
      private acceptedSuggestionChange = false;
      private composing = false;
      private cooldownUntil = 0;
      private unsubscribePartial?: () => void;
      private variants: string[] = [];
      private variantIndex = 0;
      private variantKey = "";
      private lastKind: IdeaAutocompleteSuggestionKind = "sentence";
      private direction = "";
      private requestContext: { from: number; prefix: string; suffix: string } | null = null;
      private requestBase = "";
      private requestKind: IdeaAutocompleteSuggestionKind = "sentence";
      private requestStartedAt = 0;
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

        if (update.docChanged) {
          if (this.lastEditAccepted && update.transactions.some((transaction) => transaction.isUserEvent("undo"))) recordAutocompleteMetric("undone");
          this.lastEditAccepted = this.acceptedSuggestionChange;
          this.acceptedSuggestionChange = false;
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

        // Editing, moving the cursor or leaving the editor clears a suggestion;
        // nothing here ever starts a request.
        if (update.docChanged || update.selectionSet || (update.focusChanged && !this.view.hasFocus)) {
          this.clearSuggestion();
        }
      }

      destroy() {
        controllers.delete(this.view);
        this.unsubscribePartial?.();
        this.cancelInFlight();
        this.setStatus({ state: "idle" });
      }

      setComposing(composing: boolean) {
        this.composing = composing;
        this.clearSuggestion();
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
        this.clearSuggestion();
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
        if (!this.suggestion && !this.inFlightRequestId) {
          return false;
        }

        this.clearSuggestion();
        this.view.dispatch({ effects: refreshAutocompleteEffect.of(undefined) });
        this.setStatus({ state: "idle" });
        return true;
      }

      triggerManual(kind: IdeaAutocompleteSuggestionKind = "sentence", direction = "") {
        this.lastKind = kind;
        this.direction = direction;
        this.clearSuggestion();
        this.view.dispatch({ effects: refreshAutocompleteEffect.of(undefined) });

        if (!this.canRequest()) {
          return false;
        }

        void this.requestSuggestion(kind);
        return true;
      }

      /**
       * A length key: one request for exactly that length. A visible, shorter
       * suggestion is extended (only the missing part is generated); otherwise
       * a fresh suggestion of that length is requested.
       */
      lengthKey(kind: IdeaAutocompleteSuggestionKind) {
        const selection = this.view.state.selection;
        // Length keys only ever write new text; over a selection they do nothing
        // (and never fall through to defaults such as toggleComment on Mod-/).
        if (selection.ranges.length !== 1 || !selection.main.empty) return true;
        if (this.composing) return false;
        if (this.inFlightRequestId) {
          if (this.requestKind === kind) return true;
          // Switch lengths mid-request: keep an accepted-looking base draft, drop a partial fresh one.
          const base = this.requestBase;
          this.cancelInFlight();
          this.suggestion = base && this.suggestion ? { ...this.suggestion, insert: base } : null;
          this.view.dispatch({ effects: refreshAutocompleteEffect.of(undefined) });
        }
        const order: IdeaAutocompleteSuggestionKind[] = ["sentence", "paragraph", "idea"];
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
            !selection.main.empty || selection.main.from !== current.from || !this.canRequest(true)) return false;
        void this.requestSuggestion(next, current.insert);
        return true;
      }

      private canRequest(extending = false) {
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

        const selection = this.view.state.selection.main;

        if (this.view.state.selection.ranges.length !== 1 || !selection.empty || this.inFlightRequestId || (this.suggestion && !extending)) {
          return false;
        }

        return true;
      }

      private async requestSuggestion(suggestionKind: IdeaAutocompleteSuggestionKind, base = "") {
        const selection = this.view.state.selection.main;

        if (!selection.empty || !options.workspaceSessionId || !options.documentRelativePath) {
          return;
        }

        const contextOptions = {
          minPrefixChars: 8,
          includePreviousBlockOnEmptyPrefix: true,
          includePreviousBlockOnShortPrefix: true,
          blockedLineRanges: options.blockedLineRanges
        };
        const context = buildAutocompleteContext(this.view.state.doc.toString(), selection.from, contextOptions);

        if (!context) {
          this.setStatus({ state: "idle" });
          return;
        }

        const requestId = `idea-autocomplete-${Date.now()}-${++requestSequence}`;
        const direction = this.direction;
        // Extended drafts and fresh suggestions are not comparable alternatives.
        const variantKey = JSON.stringify([selection.from, context, suggestionKind, direction, base]);
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
        this.requestStartedAt = Date.now();
        this.measuredVisible = false;
        recordAutocompleteMetric("requested");
        this.inFlightRequestId = requestId;
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
            suggestionKind,
            extend: Boolean(base),
            direction,
            avoid: base ? [] : previousVariants
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
            const cooldownMs = autocompleteCooldownMsForFailure(result.reason);
            if (cooldownMs > 0) this.cooldownUntil = applySharedAutocompleteCooldown(result.reason);
            if (this.suggestion) {
              this.renderSuggestion();
              // A refusal the writer must act on (free AI out, key problems) still
              // shows its notice; the visible draft stays and can be accepted.
              if (autocompleteFailureNeedsNotice(result.reason)) {
                this.setStatus({ state: "failed", reason: result.reason, resetAt: result.resetAt });
              }
              return;
            }

            if (result.reason !== "aborted") {
              this.setStatus({ state: "failed", reason: result.reason, resetAt: result.resetAt });
            }

            return;
          }

          const latestSelection = this.view.state.selection.main;
          const latestContext = buildAutocompleteContext(this.view.state.doc.toString(), latestSelection.from, contextOptions);

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
        if (this.suggestion) {
          this.suggestion = null;
          this.decorations = buildDecorations(null);
        }

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
    // Length keys outrank other editor bindings on the same keys (e.g. the
    // corrector's Mod-. or CodeMirror's Mod-/ comment toggle); users can remap them.
    // The `continue` key only opens the ✦ AI menu (selection comments extension).
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
