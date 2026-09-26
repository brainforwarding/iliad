import type { EditorView, ViewUpdate } from "@codemirror/view";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject
} from "react";
import type { AiRoute, SelectionComment, TightenFailureReason, TightenResult } from "../../types/iliad";
import { AiNoticeBar } from "../../components/AiNoticeBar";
import { aiNoticeForReason, type AiNoticeLabels } from "../aiNotice";
import { isAnchoredSelectionComment } from "../../app/selectionCommentsAnchor";
import { aiMenuKeyAction } from "./extension";
import { anchoredOverlayPosition, type OverlayPosition } from "./positioning";
import { safeTightenRangeForSelection, type SafeTightenRange, type TightenInlineReview } from "../tightenSafeRange";
import { normalizeSelectionEditInstruction, selectionEditInstructionIsTooLong } from "../selectionEditScope";

const SETTLE_DELAY_MS = 180;
const HOVER_SHOW_DELAY_MS = 300;
const HOVER_HIDE_DELAY_MS = 180;

export interface SelectionCommentsEditorLabels {
  action: string;
  composerLabel: string;
  composerPlaceholder: string;
  edit: string;
  delete: string;
  /** "N detached comments" toolbar (spec V18). */
  detached?: (count: number) => string;
  detachedHint?: string;
}

export interface SelectionCommentsOverlayApi {
  handleMouseUp: (view: EditorView) => void;
  handleMouseMove: (event: MouseEvent, view: EditorView) => void;
  handleEditorUpdate: (update: ViewUpdate) => void;
  handleCommentShortcut: (view: EditorView) => boolean;
  handleTightenShortcut: (view: EditorView) => boolean;
  /** The ✦ AI menu key: opens the menu over a selection, does nothing without one. Always consumes the key. */
  handleAiMenuShortcut: (view: EditorView) => boolean;
  handleEscape: (view: EditorView) => boolean;
}

export const selectionAiPresets = ["rewrite", "expand", "shorten", "summarize", "list"] as const;
export type SelectionAiPreset = (typeof selectionAiPresets)[number];

export interface TightenOverlayLabels {
  action: string;
  working: string;
  alreadyTight: string;
  failed: string;
  incomplete: string;
  blocked: string;
  tooLong: string;
  editAction: string;
  editComposerLabel: string;
  editComposerPlaceholder: string;
  editWorking: string;
  editUnchanged: string;
  editFailed: string;
  editTooLong: string;
  aiAction: string;
  aiMenuLabel: string;
  aiMenuPlaceholder: string;
  presets: Record<SelectionAiPreset, string>;
  /** Shorten runs the dedicated tighten mode; every other preset is a canned edit instruction. */
  presetInstructions: Record<Exclude<SelectionAiPreset, "shorten">, string>;
}

export interface TightenOverlayApi {
  /** A Markdown file is active. ✦ AI needs no key (free route by default). */
  enabled: boolean;
  /** Opens Writing assists with the Groq key form expanded (a notice's "Use my key" / "Update key"). */
  onRequestKey?: () => void;
  /** The current AI route, for route-specific notice copy (null while unknown). */
  route: AiRoute | null;
  language: "en" | "es";
  noticeLabels: AiNoticeLabels;
  minChars: number;
  maxChars: number;
  /** Current active-file path — compared at accept time to discard a file-switch race. */
  filePath: string;
  labels: TightenOverlayLabels;
  /** Display label of the AI key (e.g. ⌘+Enter), shown on the selection bar. */
  aiKeyLabel?: string;
  run: (
    requestId: string,
    text: string,
    selection: { from: number; to: number },
    options?: { mode?: "tighten" | "edit"; instruction?: string }
  ) => Promise<TightenResult>;
  cancel: (requestId: string) => void;
  onProposedRangeChange: (range: { from: number; to: number } | null) => void;
  reviewActive: boolean;
  onReviewReady: (review: TightenInlineReview) => void;
  onRejectReview: () => void;
}

type TightenViewState =
  | { phase: "idle" }
  | { phase: "working"; requestId: string; anchorPos: number; kind: "tighten" | "edit" }
  | { phase: "alreadyTight"; anchorPos: number; kind: "tighten" | "edit" }
  | { phase: "error"; reason: TightenFailureReason; resetAt?: string; anchorPos: number; kind: "tighten" | "edit" };

interface SelectionCommentsOverlayProps {
  view: EditorView | null;
  comments: SelectionComment[];
  labels: SelectionCommentsEditorLabels;
  apiRef: MutableRefObject<SelectionCommentsOverlayApi | null>;
  onCreateComment: (draft: { from: number; to: number; comment: string }) => void;
  onUpdateComment: (id: string, text: string) => void;
  onDeleteComment: (id: string) => void;
  onProvisionalRangeChange: (range: { from: number; to: number } | null) => void;
  tighten?: TightenOverlayApi;
}

interface ComposerState {
  from: number;
  to: number;
  anchorPos: number;
  editingId: string | null;
}

interface EditComposerState {
  safeRange: SafeTightenRange;
  anchorPos: number;
}

interface HoverState {
  ids: string[];
  anchorPos: number;
}

function surfaceMetricsFor(view: EditorView) {
  const surface = view.dom.closest<HTMLElement>(".editor-surface");

  if (!surface) {
    return null;
  }

  const rect = surface.getBoundingClientRect();
  return {
    rectTop: rect.top,
    rectLeft: rect.left,
    scrollTop: surface.scrollTop,
    scrollLeft: surface.scrollLeft,
    width: surface.clientWidth,
    viewportHeight: window.innerHeight
  };
}

function anchorCoords(view: EditorView, pos: number) {
  try {
    return view.coordsAtPos(Math.max(0, Math.min(pos, view.state.doc.length)));
  } catch {
    return null;
  }
}

function overlayPositionAt(
  view: EditorView,
  pos: number,
  size: { width: number; height: number },
  prefer: "above" | "below"
): OverlayPosition | null {
  const coords = anchorCoords(view, pos);
  const surface = surfaceMetricsFor(view);

  if (!coords || !surface) {
    return null;
  }

  return anchoredOverlayPosition({
    anchor: { top: coords.top, bottom: coords.bottom, left: coords.left },
    surface,
    size,
    prefer
  });
}

/**
 * Editor-anchored chrome for selection comments: the floating "Comentar"
 * action, the inline comment composer, and the hover popover. All positions
 * derive from `view.coordsAtPos()` converted into `.editor-surface` content
 * coordinates, so they travel with the document on scroll and are recomputed
 * (never cached) across layout reflows such as visualMarkdown syntax reveal.
 */
export function SelectionCommentsOverlay({
  view,
  comments,
  labels,
  apiRef,
  onCreateComment,
  onUpdateComment,
  onDeleteComment,
  onProvisionalRangeChange,
  tighten
}: SelectionCommentsOverlayProps) {
  const [floatingPos, setFloatingPos] = useState<number | null>(null);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [draft, setDraft] = useState("");
  const [editComposer, setEditComposer] = useState<EditComposerState | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [aiPresetIndex, setAiPresetIndex] = useState(0);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [, setLayoutVersion] = useState(0);
  const [tightenState, setTightenState] = useState<TightenViewState>({ phase: "idle" });
  const tightenStateRef = useRef(tightenState);
  tightenStateRef.current = tightenState;
  const tightenRef = useRef(tighten);
  tightenRef.current = tighten;
  const tightenSeqRef = useRef(0);
  const currentTightenIdRef = useRef<string | null>(null);
  const tightenDismissTimer = useRef<number | null>(null);
  const dismissTightenRef = useRef<() => void>(() => {});
  const rootRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const settleTimer = useRef<number | null>(null);
  const hoverShowTimer = useRef<number | null>(null);
  const hoverHideTimer = useRef<number | null>(null);
  const composerRef = useRef<ComposerState | null>(null);
  composerRef.current = composer;
  const editComposerRef = useRef<EditComposerState | null>(null);
  editComposerRef.current = editComposer;
  const floatingRef = useRef<number | null>(null);
  floatingRef.current = floatingPos;
  const hoverRef = useRef<HoverState | null>(null);
  hoverRef.current = hover;
  const commentsRef = useRef(comments);
  commentsRef.current = comments;

  const clearTimer = (timer: MutableRefObject<number | null>) => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const hideHover = useCallback(() => {
    clearTimer(hoverShowTimer);
    clearTimer(hoverHideTimer);
    setHover(null);
  }, []);

  const openComposer = useCallback(
    (from: number, to: number, anchorPos: number, editingId: string | null, initialDraft: string) => {
      dismissTightenRef.current();
      if (editComposerRef.current) {
        tightenRef.current?.onProposedRangeChange(null);
        setEditComposer(null);
        setEditDraft("");
      }
      setFloatingPos(null);
      hideHover();
      setComposer({ from, to, anchorPos, editingId });
      setDraft(initialDraft);

      // The provisional wash marks the range the moment composing starts, so
      // the user never types about unmarked text. Editing keeps its own wash.
      if (!editingId) {
        onProvisionalRangeChange({ from, to });
      }
    },
    [hideHover, onProvisionalRangeChange]
  );

  const closeComposer = useCallback(
    (save: boolean) => {
      const current = composerRef.current;

      if (!current) {
        return;
      }

      const text = draft.trim();

      if (save && text) {
        if (current.editingId) {
          onUpdateComment(current.editingId, text);
        } else {
          onCreateComment({ from: current.from, to: current.to, comment: text });
        }
      }

      onProvisionalRangeChange(null);
      setComposer(null);
      setDraft("");
      view?.focus();
    },
    [draft, onCreateComment, onProvisionalRangeChange, onUpdateComment, view]
  );

  const closeComposerRef = useRef(closeComposer);
  closeComposerRef.current = closeComposer;

  const closeEditComposer = useCallback((focusEditor: boolean) => {
    tightenRef.current?.onProposedRangeChange(null);
    setEditComposer(null);
    setEditDraft("");

    if (focusEditor) {
      view?.focus();
    }
  }, [view]);

  const closeEditComposerRef = useRef(closeEditComposer);
  closeEditComposerRef.current = closeEditComposer;

  const openEditComposer = useCallback(
    (startView: EditorView) => {
      const activeTighten = tightenRef.current;

      if (!activeTighten?.enabled || composerRef.current) {
        return;
      }

      const selection = startView.state.selection.main;

      if (selection.empty) {
        return;
      }

      const safeRange = safeTightenRangeForSelection(startView.state.doc.toString(), {
        from: selection.from,
        to: selection.to
      });

      if (!safeRange || safeRange.originalText.length > activeTighten.maxChars) {
        return;
      }

      dismissTightenRef.current();
      setFloatingPos(null);
      hideHover();
      activeTighten.onRejectReview();
      activeTighten.onProposedRangeChange({
        from: safeRange.from + safeRange.selectedFrom,
        to: safeRange.from + safeRange.selectedTo
      });
      setEditComposer({ safeRange, anchorPos: selection.head });
      setEditDraft("");
      setAiPresetIndex(0);
    },
    [hideHover]
  );

  const handleMouseUp = useCallback((mouseUpView: EditorView) => {
    clearTimer(settleTimer);
    // Mouseup-only, after a settle delay: keyboard and programmatic selections
    // never summon the action, and it never appears mid-drag.
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;

      if (composerRef.current || editComposerRef.current) {
        return;
      }

      const selection = mouseUpView.state.selection.main;

      if (selection.empty) {
        return;
      }

      if (!mouseUpView.state.sliceDoc(selection.from, selection.to).trim()) {
        return;
      }

      setFloatingPos(selection.head);
    }, SETTLE_DELAY_MS);
  }, []);

  const handleEditorUpdate = useCallback(
    (update: ViewUpdate) => {
      if (update.docChanged) {
        clearTimer(settleTimer);
        setFloatingPos(null);
        hideHover();

        if (tightenRef.current?.reviewActive) {
          tightenRef.current.onRejectReview();
        }

        dismissTightenRef.current();

        if (composerRef.current) {
          // A document edit invalidates the range being composed: cancel.
          onProvisionalRangeChange(null);
          setComposer(null);
          setDraft("");
        }

        if (editComposerRef.current) {
          tightenRef.current?.onProposedRangeChange(null);
          setEditComposer(null);
          setEditDraft("");
        }

        return;
      }

      if (update.selectionSet) {
        // Dismiss on selection change — but never on scroll.
        clearTimer(settleTimer);
        setFloatingPos(null);
        dismissTightenRef.current();
      }

      if (update.geometryChanged) {
        // Layout reflowed (e.g. syntax reveal): recompute anchored positions.
        setLayoutVersion((version) => version + 1);
      }
    },
    [hideHover, onProvisionalRangeChange]
  );

  const handleCommentShortcut = useCallback(
    (shortcutView: EditorView) => {
      const selection = shortcutView.state.selection.main;

      if (!editComposerRef.current && !selection.empty && shortcutView.state.sliceDoc(selection.from, selection.to).trim()) {
        openComposer(selection.from, selection.to, selection.head, null, "");
        return true;
      }

      const cursor = selection.head;
      const target = commentsRef.current.find(
        (comment) =>
          comment.status === "pending" &&
          isAnchoredSelectionComment(comment) &&
          cursor >= comment.from &&
          cursor <= comment.to
      );

      if (target) {
        openComposer(target.from, target.to, target.from, target.id, target.comment);
        return true;
      }

      return false;
    },
    [openComposer]
  );

  const handleEscape = useCallback(() => {
    if (editComposerRef.current) {
      closeEditComposerRef.current(true);
      return true;
    }

    if (tightenRef.current?.reviewActive) {
      tightenRef.current.onRejectReview();
      resetTighten();
      return true;
    }

    if (tightenStateRef.current.phase !== "idle") {
      dismissTightenRef.current();
      return true;
    }

    if (composerRef.current) {
      closeComposerRef.current(false);
      return true;
    }

    if (floatingRef.current !== null) {
      clearTimer(settleTimer);
      setFloatingPos(null);
      return true;
    }

    if (hoverRef.current) {
      hideHover();
      return true;
    }

    return false;
  }, [hideHover]);

  const handleMouseMove = useCallback(
    (event: MouseEvent, moveView: EditorView) => {
      if (composerRef.current || editComposerRef.current) {
        return;
      }

      const pos = moveView.posAtCoords({ x: event.clientX, y: event.clientY });
      const hovered =
        pos === null
          ? []
          : commentsRef.current.filter(
              (comment) =>
                comment.status === "pending" &&
                isAnchoredSelectionComment(comment) &&
                pos >= comment.from &&
                pos <= comment.to
            );

      if (hovered.length === 0) {
        clearTimer(hoverShowTimer);

        if (hoverRef.current && hoverHideTimer.current === null) {
          hoverHideTimer.current = window.setTimeout(() => {
            hoverHideTimer.current = null;
            setHover(null);
          }, HOVER_HIDE_DELAY_MS);
        }

        return;
      }

      clearTimer(hoverHideTimer);
      const ids = hovered.map((comment) => comment.id);
      const anchorPos = Math.min(...hovered.map((comment) => comment.from));
      const current = hoverRef.current;

      if (current && current.ids.join("|") === ids.join("|")) {
        return;
      }

      if (current) {
        setHover({ ids, anchorPos });
        return;
      }

      if (hoverShowTimer.current === null) {
        hoverShowTimer.current = window.setTimeout(() => {
          hoverShowTimer.current = null;
          setHover({ ids, anchorPos });
        }, HOVER_SHOW_DELAY_MS);
      }
    },
    []
  );

  const clearTightenTimer = () => {
    if (tightenDismissTimer.current !== null) {
      window.clearTimeout(tightenDismissTimer.current);
      tightenDismissTimer.current = null;
    }
  };

  const resetTighten = () => {
    clearTightenTimer();
    currentTightenIdRef.current = null;
    tightenRef.current?.onProposedRangeChange(null);
    setTightenState({ phase: "idle" });
  };

  const dismissTighten = () => {
    const state = tightenStateRef.current;
    const id = currentTightenIdRef.current;
    const activeTighten = tightenRef.current;

    if (id && state.phase === "working") {
      activeTighten?.cancel(id);
    }

    resetTighten();
  };
  dismissTightenRef.current = dismissTighten;

  const scheduleTightenAutoDismiss = () => {
    clearTightenTimer();
    tightenDismissTimer.current = window.setTimeout(() => {
      tightenDismissTimer.current = null;
      resetTighten();
    }, 1600);
  };

  /**
   * Every selection AI action (Shorten, presets, typed instructions) changes only
   * the selected text; the surrounding safe unit is sent as context. The result
   * goes through the inline review — nothing is written until it is accepted.
   */
  const runSelectionTransform = (safeRange: SafeTightenRange, mode: "tighten" | "edit", instruction?: string) => {
    const activeTighten = tightenRef.current;

    if (!activeTighten?.enabled) {
      return;
    }

    const kind = mode;
    const anchorPos = safeRange.from;
    const requestId = `${mode === "edit" ? "e" : "t"}${(tightenSeqRef.current += 1)}`;
    currentTightenIdRef.current = requestId;

    clearTimer(settleTimer);
    setFloatingPos(null);
    hideHover();
    setEditComposer(null);
    setEditDraft("");
    activeTighten.onRejectReview();
    setTightenState({ phase: "working", requestId, anchorPos, kind });
    activeTighten.onProposedRangeChange({
      from: safeRange.from + safeRange.selectedFrom,
      to: safeRange.from + safeRange.selectedTo
    });

    activeTighten
      .run(
        requestId,
        safeRange.originalText,
        { from: safeRange.selectedFrom, to: safeRange.selectedTo },
        mode === "edit" ? { mode: "edit", instruction } : undefined
      )
      .then((result) => {
        if (currentTightenIdRef.current !== requestId) {
          return;
        }

        if (!result.ok) {
          activeTighten.onProposedRangeChange(null);
          setTightenState({ phase: "error", reason: result.reason, resetAt: result.resetAt, anchorPos, kind });
          // An actionable notice (free AI out, key problems) stays until dismissed
          // or the writer moves on; plain errors fade out.
          if (!aiNoticeForReason(result.reason, { route: activeTighten.route, language: activeTighten.language, labels: activeTighten.noticeLabels })) {
            scheduleTightenAutoDismiss();
          } else {
            clearTightenTimer();
          }
          return;
        }

        if (result.unchanged) {
          activeTighten.onProposedRangeChange(null);
          currentTightenIdRef.current = null;
          setTightenState({ phase: "alreadyTight", anchorPos, kind });
          scheduleTightenAutoDismiss();
          return;
        }

        currentTightenIdRef.current = null;
        activeTighten.onProposedRangeChange(null);
        activeTighten.onReviewReady({
          requestId,
          range: {
            ...safeRange,
            filePath: activeTighten.filePath
          },
          rewrite: result.rewrite
        });
        setTightenState({ phase: "idle" });
      })
      .catch(() => {
        if (currentTightenIdRef.current !== requestId) {
          return;
        }

        activeTighten.onProposedRangeChange(null);
        setTightenState({ phase: "error", reason: "provider", anchorPos, kind });
        scheduleTightenAutoDismiss();
      });
  };

  const startTighten = (startView: EditorView) => {
    const activeTighten = tightenRef.current;

    if (!activeTighten?.enabled || composerRef.current || editComposerRef.current) {
      return;
    }

    const selection = startView.state.selection.main;

    if (selection.empty) {
      return;
    }

    const safeRange = safeTightenRangeForSelection(startView.state.doc.toString(), {
      from: selection.from,
      to: selection.to
    });

    if (!safeRange || safeRange.originalText.length > activeTighten.maxChars) {
      return;
    }

    runSelectionTransform(safeRange, "tighten");
  };

  const shortenAvailable = (safeRange: SafeTightenRange) =>
    Boolean(tightenRef.current) &&
    safeRange.originalText.slice(safeRange.selectedFrom, safeRange.selectedTo).trim().length >=
      (tightenRef.current?.minChars ?? 0);

  const runAiPreset = (preset: SelectionAiPreset) => {
    const activeTighten = tightenRef.current;
    const current = editComposerRef.current;

    if (!activeTighten?.enabled || !current) {
      return;
    }

    if (preset === "shorten") {
      if (shortenAvailable(current.safeRange)) {
        runSelectionTransform(current.safeRange, "tighten");
      }
      return;
    }

    runSelectionTransform(current.safeRange, "edit", activeTighten.labels.presetInstructions[preset]);
  };

  const submitEdit = () => {
    const activeTighten = tightenRef.current;
    const current = editComposerRef.current;

    if (!activeTighten?.enabled || !current) {
      return;
    }

    const instruction = normalizeSelectionEditInstruction(editDraft);
    const anchorPos = current.safeRange.from;

    if (!instruction) {
      closeEditComposerRef.current(true);
      return;
    }

    if (selectionEditInstructionIsTooLong(instruction)) {
      closeEditComposerRef.current(true);
      setTightenState({ phase: "error", reason: "too_long", anchorPos, kind: "edit" });
      scheduleTightenAutoDismiss();
      return;
    }

    runSelectionTransform(current.safeRange, "edit", instruction);
  };

  const handleTightenShortcut = (shortcutView: EditorView) => {
    const activeTighten = tightenRef.current;

    if (!activeTighten || composerRef.current || editComposerRef.current) {
      return false;
    }

    if (!activeTighten.enabled) {
      return false;
    }

    const selection = shortcutView.state.selection.main;

    if (selection.empty) {
      return false;
    }

    const safeRange = safeTightenRangeForSelection(shortcutView.state.doc.toString(), {
      from: selection.from,
      to: selection.to
    });
    const trimmed = shortcutView.state.sliceDoc(selection.from, selection.to).trim();

    if (!safeRange || trimmed.length < activeTighten.minChars || safeRange.originalText.length > activeTighten.maxChars) {
      return false;
    }

    startTighten(shortcutView);
    return true;
  };

  const handleAiMenuShortcut = (shortcutView: EditorView) => {
    // The ✦ AI key only opens the menu over a selection. With nothing selected
    // it does nothing (no suggestion, and no fall-through to insertBlankLine).
    if (aiMenuKeyAction(shortcutView.state.selection) === "nothing") {
      return true;
    }

    if (!composerRef.current && !editComposerRef.current && tightenStateRef.current.phase !== "working") {
      openEditComposer(shortcutView);
    }

    // Consume the AI key over any selection so it never falls through to a
    // default that edits the document (CodeMirror binds Mod-Enter to insertBlankLine).
    return true;
  };

  apiRef.current = {
    handleMouseUp,
    handleMouseMove,
    handleEditorUpdate,
    handleCommentShortcut,
    handleTightenShortcut,
    handleAiMenuShortcut,
    handleEscape
  };

  useEffect(() => {
    const ref = apiRef;

    return () => {
      ref.current = null;
    };
  }, [apiRef]);

  const onProvisionalRangeChangeRef = useRef(onProvisionalRangeChange);
  onProvisionalRangeChangeRef.current = onProvisionalRangeChange;

  useEffect(() => {
    return () => {
      clearTimer(settleTimer);
      clearTimer(hoverShowTimer);
      clearTimer(hoverHideTimer);
      if (tightenDismissTimer.current !== null) {
        window.clearTimeout(tightenDismissTimer.current);
      }
      const currentTightenId = currentTightenIdRef.current;

      if (currentTightenId && tightenStateRef.current.phase === "working") {
        tightenRef.current?.cancel(currentTightenId);
      }

      // Never leave a provisional wash behind when the overlay unmounts.
      onProvisionalRangeChangeRef.current(null);
      tightenRef.current?.onProposedRangeChange(null);
      tightenRef.current?.onRejectReview();
    };
  }, []);

  // Click elsewhere dismisses the floating action, composer, and selection-transform chrome.
  useEffect(() => {
    const tightenActive = tightenState.phase !== "idle";

    if (floatingPos === null && !composer && !editComposer && !tightenActive) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }

      if (composerRef.current) {
        closeComposerRef.current(false);
      }

      if (editComposerRef.current) {
        closeEditComposerRef.current(false);
      }

      if (tightenStateRef.current.phase !== "idle") {
        dismissTightenRef.current();
      }

      clearTimer(settleTimer);
      setFloatingPos(null);
    };

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [composer, editComposer, floatingPos, tightenState.phase]);

  // Auto-grow the composer textarea up to ~3 lines.
  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 66)}px`;
  }, [draft, composer]);

  useEffect(() => {
    const textarea = editTextareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 88)}px`;
  }, [editDraft, editComposer]);

  if (!view) {
    return null;
  }

  const hoveredComments = hover
    ? hover.ids
        .map((id) => comments.find((comment) => comment.id === id))
        .filter((comment): comment is SelectionComment => Boolean(comment && comment.status === "pending"))
    : [];

  const tightenSelectionMetrics =
    tighten && floatingPos !== null && !view.state.selection.main.empty
      ? (() => {
          const selection = view.state.selection.main;
          const slice = view.state.sliceDoc(selection.from, selection.to);
          const safeRange = safeTightenRangeForSelection(view.state.doc.toString(), {
            from: selection.from,
            to: selection.to
          });
          return {
            hasSafeRange: Boolean(safeRange),
            safeLength: safeRange?.originalText.length ?? 0,
            trimmedLength: slice.trim().length
          };
        })()
      : null;
  const showEditAction = Boolean(tighten && tightenSelectionMetrics?.hasSafeRange);
  const tightenOverCap = Boolean(
    tighten?.enabled && tightenSelectionMetrics && tightenSelectionMetrics.safeLength > tighten.maxChars
  );
  const floatingWidth = 96 + (showEditAction ? 96 : 0);
  const floatingPosition =
    floatingPos !== null
      ? overlayPositionAt(view, floatingPos, { width: floatingWidth, height: 26 }, "above")
      : null;
  const tightenAnchorPos =
    tightenState.phase === "working" || tightenState.phase === "alreadyTight" || tightenState.phase === "error"
      ? tightenState.anchorPos
      : null;
  const tightenStatusPosition =
    tightenAnchorPos !== null
      ? overlayPositionAt(view, tightenAnchorPos, { width: 220, height: 30 }, "above")
      : null;
  const tightenNotice =
    tighten && tightenState.phase === "error"
      ? aiNoticeForReason(tightenState.reason, {
          route: tighten.route,
          resetAt: tightenState.resetAt,
          language: tighten.language,
          labels: tighten.noticeLabels
        })
      : null;
  const tightenErrorLabel =
    tighten && tightenState.phase === "error"
      ? tightenState.kind === "edit"
        ? tightenState.reason === "too_long"
          ? tighten.labels.editTooLong
          : sharedTightenErrorLabel(tightenState.reason, tighten.labels) ?? tighten.labels.editFailed
        : sharedTightenErrorLabel(tightenState.reason, tighten.labels) ?? tighten.labels.failed
      : "";
  const composerPosition = composer
    ? overlayPositionAt(view, composer.anchorPos, { width: 280, height: 92 }, "below")
    : null;
  const editComposerPosition = editComposer
    ? overlayPositionAt(view, editComposer.anchorPos, { width: 320, height: 250 }, "below")
    : null;
  const hoverPosition =
    hoveredComments.length > 0 && hover
      ? overlayPositionAt(
          view,
          hover.anchorPos,
          { width: 300, height: Math.min(48 + hoveredComments.length * 56, 240) },
          "below"
        )
      : null;

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeComposer(false);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      closeComposer(true);
    }
  };

  return (
    <div className="editor-comment-overlay" ref={rootRef}>
      {floatingPosition ? (
        <div
          className="editor-selection-actions"
          style={{ top: floatingPosition.top, left: floatingPosition.left }}
        >
          <button
            type="button"
            className="editor-comment-action"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              const selection = view.state.selection.main;

              if (!selection.empty) {
                openComposer(selection.from, selection.to, selection.head, null, "");
              }
            }}
          >
            {labels.action}
          </button>
          {showEditAction && tighten ? (
            <button
              type="button"
              className="editor-ai-action"
              disabled={tightenOverCap}
              title={tightenOverCap ? tighten.labels.editTooLong : tighten.labels.aiMenuLabel}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (!tightenOverCap) {
                  openEditComposer(view);
                }
              }}
            >
              <span aria-hidden="true">✦</span>
              {tighten.labels.aiAction}
              {tighten.aiKeyLabel ? <kbd>{tighten.aiKeyLabel}</kbd> : null}
            </button>
          ) : null}
        </div>
      ) : null}

      {tighten && tightenStatusPosition && tightenState.phase === "working" ? (
        <div
          className="editor-tighten-status"
          style={{ top: tightenStatusPosition.top, left: tightenStatusPosition.left }}
          role="status"
          aria-live="polite"
        >
          {tightenState.kind === "edit" ? tighten.labels.editWorking : tighten.labels.working}
        </div>
      ) : null}

      {tighten && tightenStatusPosition && tightenState.phase === "alreadyTight" ? (
        <div
          className="editor-tighten-status is-ok"
          style={{ top: tightenStatusPosition.top, left: tightenStatusPosition.left }}
          role="status"
          aria-live="polite"
        >
          {tightenState.kind === "edit" ? tighten.labels.editUnchanged : tighten.labels.alreadyTight}
        </div>
      ) : null}

      {tighten && tightenStatusPosition && tightenState.phase === "error" && tightenNotice ? (
        <AiNoticeBar
          notice={tightenNotice}
          labels={tighten.noticeLabels}
          style={{ top: tightenStatusPosition.top, left: tightenStatusPosition.left }}
          onAction={
            tighten.onRequestKey
              ? () => {
                  resetTighten();
                  tighten.onRequestKey?.();
                }
              : undefined
          }
          onDismiss={() => {
            resetTighten();
            view.focus();
          }}
        />
      ) : null}

      {tighten && tightenStatusPosition && tightenState.phase === "error" && !tightenNotice ? (
        <div
          className="editor-tighten-status is-error"
          style={{ top: tightenStatusPosition.top, left: tightenStatusPosition.left }}
          role="status"
          aria-live="polite"
        >
          {tightenErrorLabel}
        </div>
      ) : null}

      {composer && composerPosition ? (
        <div
          className="editor-comment-composer"
          style={{ top: composerPosition.top, left: composerPosition.left }}
          role="dialog"
          aria-label={labels.composerLabel}
        >
          <textarea
            ref={textareaRef}
            value={draft}
            placeholder={labels.composerPlaceholder}
            rows={1}
            autoFocus
            aria-label={labels.composerLabel}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onComposerKeyDown}
          />
        </div>
      ) : null}

      {editComposer && editComposerPosition && tighten ? (() => {
        const presetEnabled = (preset: SelectionAiPreset) => preset !== "shorten" || shortenAvailable(editComposer.safeRange);
        const enabledPresets = selectionAiPresets.filter(presetEnabled);
        const activePreset = editDraft.trim() ? null : enabledPresets[Math.min(aiPresetIndex, enabledPresets.length - 1)] ?? null;

        return (
          <div
            className="editor-comment-composer editor-edit-composer editor-ai-menu"
            style={{ top: editComposerPosition.top, left: editComposerPosition.left }}
            role="dialog"
            aria-label={tighten.labels.aiMenuLabel}
          >
            <textarea
              ref={editTextareaRef}
              value={editDraft}
              placeholder={tighten.labels.aiMenuPlaceholder}
              rows={1}
              autoFocus
              aria-label={tighten.labels.editComposerLabel}
              onChange={(event) => setEditDraft(event.target.value)}
              onKeyDown={(event) => {
                // Menu keys never reach the editor keymaps behind the menu.
                event.stopPropagation();

                if (event.key === "Escape") {
                  event.preventDefault();
                  closeEditComposer(true);
                  return;
                }

                if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !editDraft.trim()) {
                  event.preventDefault();
                  const step = event.key === "ArrowDown" ? 1 : -1;
                  setAiPresetIndex((index) => (Math.min(index, enabledPresets.length - 1) + step + enabledPresets.length) % enabledPresets.length);
                  return;
                }

                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();

                  if (editDraft.trim()) {
                    submitEdit();
                  } else if (activePreset) {
                    runAiPreset(activePreset);
                  }
                }
              }}
            />
            <div className="editor-ai-menu-presets" role="listbox" aria-label={tighten.labels.aiMenuLabel}>
              {selectionAiPresets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  role="option"
                  aria-selected={preset === activePreset}
                  className={preset === activePreset ? "editor-ai-menu-preset is-active" : "editor-ai-menu-preset"}
                  disabled={!presetEnabled(preset)}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => {
                    const index = enabledPresets.indexOf(preset);
                    if (index >= 0 && !editDraft.trim()) setAiPresetIndex(index);
                  }}
                  onClick={() => runAiPreset(preset)}
                >
                  <span>{tighten.labels.presets[preset]}</span>
                  {preset === activePreset ? <kbd>↵</kbd> : null}
                </button>
              ))}
            </div>
          </div>
        );
      })() : null}

      {hoverPosition && hoveredComments.length > 0 ? (
        <div
          className="editor-comment-popover"
          style={{ top: hoverPosition.top, left: hoverPosition.left }}
          onMouseEnter={() => clearTimer(hoverHideTimer)}
          onMouseLeave={() => {
            clearTimer(hoverHideTimer);
            hoverHideTimer.current = window.setTimeout(() => {
              hoverHideTimer.current = null;
              setHover(null);
            }, HOVER_HIDE_DELAY_MS);
          }}
        >
          {hoveredComments.map((comment) => (
            <div className="editor-comment-popover-row" key={comment.id}>
              <p>{comment.comment}</p>
              <div className="editor-comment-popover-actions">
                <button
                  type="button"
                  onClick={() => openComposer(comment.from, comment.to, comment.from, comment.id, comment.comment)}
                >
                  {labels.edit}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    hideHover();
                    onDeleteComment(comment.id);
                  }}
                >
                  {labels.delete}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function sharedTightenErrorLabel(reason: TightenFailureReason, labels: TightenOverlayLabels) {
  switch (reason) {
    case "incomplete":
      return labels.incomplete;
    case "blocked":
      return labels.blocked;
    default:
      return null;
  }
}
