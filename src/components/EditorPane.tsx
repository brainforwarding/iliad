import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { aiReviewExtension } from "../editor/aiReview/extension";
import { reviewHunksForDisplay, type DisplayReviewHunk } from "../editor/aiReview/diff";
import type { EditorReviewState } from "../editor/aiReview/types";
import { imageDropPasteExtension } from "../editor/imageDropPaste";
import { ideaAutocompleteExtension, type IdeaAutocompleteStatus } from "../editor/ideaAutocomplete/extension";
import {
  selectionCommentsExtension,
  type SelectionCommentPositionUpdate,
  type SelectionCommentWashRange
} from "../editor/selectionComments/extension";
import {
  SelectionCommentsOverlay,
  type SelectionCommentsEditorLabels,
  type SelectionCommentsOverlayApi,
  type TightenOverlayLabels
} from "../editor/selectionComments/overlay";
import { visualMarkdown, visualMarkdownInteractionResetEffect } from "../editor/visualMarkdown";
import { proseEnterExtension } from "../editor/proseEnter";
import { writingCorrectorExtension } from "../editor/writingCorrector/extension";
import { detectWritingIssues } from "../editor/writingCorrector/harper";
import { type WritingIssue, writingIssueFingerprint, writingIssueKey } from "../editor/writingCorrector/issues";
import {
  resolveContentSearchReveal,
  type ContentSearchRevealTarget
} from "../editor/contentSearchReveal";
import type { TightenInlineReview } from "../editor/tightenSafeRange";
import type { EditorFontPreset } from "../preferences/editorPreferences";
import type {
  FileTreeNode,
  IdeaAutocompleteRequest,
  IdeaAutocompleteResult,
  SelectionComment,
  TightenResult,
  WritingCorrectorMemorySnapshot
} from "../types/iliad";
import { ClipMark } from "./ClipMark";
import { FilePlus } from "lucide-react";

export interface EditorSelectionCommentsProps {
  comments: SelectionComment[];
  onCreateComment: (draft: { from: number; to: number; comment: string }) => void;
  onUpdateComment: (id: string, text: string) => void;
  onDeleteComment: (id: string) => void;
  onPositionsChanged: (documentPath: string, updates: SelectionCommentPositionUpdate[]) => void;
  onFullReplacement: (documentPath: string, documentText: string) => void;
}

export interface EditorTightenProps {
  enabled: boolean;
  minChars: number;
  maxChars: number;
  labels: TightenOverlayLabels;
  run: (
    requestId: string,
    text: string,
    selection: { from: number; to: number },
    options?: { mode?: "tighten" | "edit"; instruction?: string }
  ) => Promise<TightenResult>;
  cancel: (requestId: string) => void;
}

export interface EditorWritingAssistsProps {
  correctorEnabled: boolean;
  autocompleteEnabled: boolean;
  autocompleteApiFallbackEnabled: boolean;
  language: "en" | "es";
  workspaceSessionId?: string;
  documentRelativePath?: string;
  labels: {
    corrector: {
      apply: string;
      ignore: string;
      addToDictionary: string;
      suggestion: string;
      source: (source: string, ruleId: string) => string;
      stale: string;
      openActions: string;
    };
    autocomplete: {
      working: string;
      noProvider: string;
      invalidApiKey: string;
      rateLimited: string;
      tooLong: string;
      timeout: string;
      unavailable: string;
      noSuggestion: string;
      unavailableInDocument: string;
    };
  };
  autocompleteIdea: (request: IdeaAutocompleteRequest) => Promise<IdeaAutocompleteResult>;
  cancelAutocompleteIdea: (requestId: string) => void;
  correctorMemory?: {
    load: () => Promise<WritingCorrectorMemorySnapshot>;
    ignoreIssue: (fingerprint: string) => Promise<WritingCorrectorMemorySnapshot>;
    addDictionaryWord: (word: string) => Promise<{ customWords: string[] }>;
  };
}

interface EditorPaneProps {
  file: FileTreeNode | null;
  /** Reports the live main selection (ADR-0017); null when empty/whitespace. */
  onActiveSelectionChange?: (range: { from: number; to: number } | null) => void;
  value: string;
  editorFontSize: number;
  editorFontPreset: EditorFontPreset;
  labels: {
    emptyTitle: string;
    emptyNewDocument: string;
    visualMarkdown: {
      markdownImage: string;
      youtubeVideo: string;
      markTaskIncomplete: string;
      markTaskComplete: string;
    };
    selectionComments: SelectionCommentsEditorLabels;
    reviewToolbar: {
      changes: (count: number) => string;
      previous: string;
      next: string;
      acceptAll: string;
      rejectAll: string;
      rejectRemaining: string;
      create: string;
      delete: string;
      discard: string;
      stale: string;
      acceptChange: string;
      rejectChange: string;
      pendingDocument: (path: string) => string;
      pendingDeleteDocument: (path: string) => string;
    };
  };
  review: EditorReviewState | null;
  selectionComments?: EditorSelectionCommentsProps;
  tighten?: EditorTightenProps;
  writingAssists?: EditorWritingAssistsProps;
  onChange: (value: string) => void;
  onInsertImage: (file: File) => Promise<string | null>;
  onInsertImageReference: (relativePath: string) => Promise<string | null>;
  onOpenLink: (href: string) => void | Promise<void>;
  onCreateDocument?: () => void;
  onEditorViewChange?: (view: EditorView) => void;
  contentSearchRevealTarget?: ContentSearchRevealTarget | null;
  onContentSearchRevealHandled?: (requestId: number) => void;
}

const fontStacks: Record<EditorFontPreset, string> = {
  serif: "'Iowan Old Style', 'New York', ui-serif, Georgia, Cambria, 'Times New Roman', serif",
  sans: "'Avenir Next', Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace"
};

const markdownEscapeHighlight = syntaxHighlighting(
  HighlightStyle.define([
    {
      tag: tags.escape,
      color: "var(--ink-1)"
    }
  ])
);

function lineNumberAt(text: string, offset: number) {
  let line = 1;
  const end = Math.max(0, Math.min(offset, text.length));

  for (let index = 0; index < end; index += 1) {
    if (text[index] === "\n") {
      line += 1;
    }
  }

  return line;
}

function splitReviewLines(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function createEditorTheme(editorFontSize: number, editorFontPreset: EditorFontPreset) {
  const fontStack = fontStacks[editorFontPreset];

  return EditorView.theme({
    "&": {
      "--editor-body-font": fontStack,
      "--editor-heading-font": fontStack,
      backgroundColor: "var(--editor)",
      color: "var(--ink-1)",
      minHeight: "100%",
      fontSize: `${editorFontSize}px`
    },
    ".cm-scroller": {
      fontFamily: "var(--editor-body-font)",
      lineHeight: editorFontPreset === "mono" ? "1.58" : "1.62",
      overflow: "auto",
      padding: "112px 0 80px"
    },
    ".cm-content": {
      maxWidth: "760px",
      minHeight: "auto",
      margin: "0 auto",
      padding: "0 44px 36vh",
      caretColor: "var(--accent)"
    },
    ".cm-focused": {
      outline: "none"
    },
    ".cm-line": {
      padding: "1px 0"
    },
    ".cm-activeLine": {
      backgroundColor: "transparent"
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "var(--selection-wash)"
    },
    ".cm-content ::selection": {
      backgroundColor: "var(--selection-wash)"
    },
    ".cm-gutters": {
      display: "none"
    }
  });
}

export function EditorPane({
  file,
  onActiveSelectionChange,
  value,
  editorFontSize,
  editorFontPreset,
  labels,
  review,
  selectionComments,
  tighten,
  writingAssists,
  onChange,
  onInsertImage,
  onInsertImageReference,
  onOpenLink,
  onCreateDocument,
  onEditorViewChange,
  contentSearchRevealTarget,
  onContentSearchRevealHandled
}: EditorPaneProps) {
  const editorTheme = useMemo(
    () => createEditorTheme(editorFontSize, editorFontPreset),
    [editorFontPreset, editorFontSize]
  );
  const editReviewDisplay = useMemo(() => {
    if (!review || review.mode !== "edit_file") {
      return null;
    }

    return reviewHunksForDisplay(review.currentContent, review.file);
  }, [review]);
  const unresolvedHunks = editReviewDisplay?.hunks ?? [];
  const readOnly = review?.mode === "create_file" || review?.mode === "delete_file" || Boolean(review?.mode === "edit_file" && review.readOnly);
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const [provisionalCommentRange, setProvisionalCommentRange] = useState<{ from: number; to: number } | null>(null);
  const [provisionalTightenRange, setProvisionalTightenRange] = useState<{ from: number; to: number } | null>(null);
  const [tightenReview, setTightenReview] = useState<TightenInlineReview | null>(null);
  const [activeWritingIssue, setActiveWritingIssue] = useState<{
    issue: WritingIssue;
    left: number;
    top: number;
  } | null>(null);
  const [autocompleteStatus, setAutocompleteStatus] = useState<IdeaAutocompleteStatus>({ state: "idle" });
  const [autocompleteStatusAnchor, setAutocompleteStatusAnchor] = useState<{ left: number; top: number } | null>(null);
  const [writingIssues, setWritingIssues] = useState<WritingIssue[]>([]);
  const [ignoredWritingIssueKeys, setIgnoredWritingIssueKeys] = useState<Set<string>>(() => new Set());
  const [customCorrectorWords, setCustomCorrectorWords] = useState<Set<string>>(() => new Set());
  const editorSurfaceRef = useRef<HTMLDivElement | null>(null);
  const writingIssuePopoverRef = useRef<HTMLDivElement | null>(null);
  const overlayApiRef = useRef<SelectionCommentsOverlayApi | null>(null);
  const handledContentRevealRequestIdRef = useRef<number | null>(null);
  const selectionCommentRanges = useMemo<SelectionCommentWashRange[]>(() => {
    if (!selectionComments) {
      return [];
    }

    return selectionComments.comments
      .filter((comment) => (comment.status === "pending" || comment.status === "sent") && comment.to > comment.from)
      .map((comment) => ({
        id: comment.id,
        from: comment.from,
        to: comment.to,
        fading: comment.status === "sent"
      }));
  }, [selectionComments]);
  const handleOverlayMouseUp = useCallback((view: EditorView) => {
    overlayApiRef.current?.handleMouseUp(view);
  }, []);
  const handleOverlayMouseMove = useCallback((event: MouseEvent, view: EditorView) => {
    overlayApiRef.current?.handleMouseMove(event, view);
  }, []);
  const handleOverlayEditorUpdate = useCallback((update: ViewUpdate) => {
    overlayApiRef.current?.handleEditorUpdate(update);
  }, []);
  const handleOverlayShortcut = useCallback(
    (view: EditorView) => overlayApiRef.current?.handleCommentShortcut(view) ?? false,
    []
  );
  const handleOverlayEscape = useCallback(
    (view: EditorView) => overlayApiRef.current?.handleEscape(view) ?? false,
    []
  );
  const handleOverlayTightenShortcut = useCallback(
    (view: EditorView) => overlayApiRef.current?.handleTightenShortcut(view) ?? false,
    []
  );
  const handleRejectTightenReview = useCallback(() => {
    setTightenReview(null);
    setProvisionalTightenRange(null);
    editorView?.focus();
  }, [editorView]);
  const handleAcceptTightenReview = useCallback(() => {
    if (!tightenReview || !editorView || file?.path !== tightenReview.range.filePath) {
      setTightenReview(null);
      setProvisionalTightenRange(null);
      return;
    }

    const { range, rewrite } = tightenReview;

    // Stale-safe accept (ADR-0020): verify file + exact original text, then
    // dispatch synchronously (no await between check and dispatch).
    if (editorView.state.sliceDoc(range.from, range.to) !== range.originalText) {
      setTightenReview(null);
      setProvisionalTightenRange(null);
      return;
    }

    setTightenReview(null);
    setProvisionalTightenRange(null);
    editorView.dispatch({
      changes: { from: range.from, to: range.to, insert: rewrite },
      selection: { anchor: range.from + rewrite.length }
    });
    editorView.focus();
  }, [editorView, file?.path, tightenReview]);

  const activeSelectionCallbackRef = useRef(onActiveSelectionChange);
  const lastReportedSelectionRef = useRef<{ from: number; to: number } | null>(null);

  useEffect(() => {
    activeSelectionCallbackRef.current = onActiveSelectionChange;
  }, [onActiveSelectionChange]);

  // Document switch reuses the CM instance; the old selection is meaningless.
  useEffect(() => {
    lastReportedSelectionRef.current = null;
    activeSelectionCallbackRef.current?.(null);
    setTightenReview(null);
    setProvisionalTightenRange(null);
    setActiveWritingIssue(null);
    setWritingIssues([]);
    setIgnoredWritingIssueKeys(new Set());
    setCustomCorrectorWords(new Set());
    setAutocompleteStatus({ state: "idle" });
    setAutocompleteStatusAnchor(null);
  }, [file?.path]);

  useEffect(() => {
    if (!editorView || !file || review) {
      return;
    }

    editorView.contentDOM.blur();
    editorView.dom.blur();
    editorView.dispatch({
      effects: visualMarkdownInteractionResetEffect.of({
        focused: false,
        interacted: false
      })
    });
  }, [editorView, file?.path, review]);

  useEffect(() => {
    const correctorMemory = writingAssists?.correctorMemory;
    const documentPath = file?.path;

    setIgnoredWritingIssueKeys(new Set());
    setCustomCorrectorWords(new Set());

    if (!correctorMemory || !documentPath) {
      return;
    }

    let cancelled = false;

    void correctorMemory
      .load()
      .then((memory) => {
        if (cancelled || file?.path !== documentPath) {
          return;
        }

        setIgnoredWritingIssueKeys(new Set(memory.ignoredIssueFingerprints));
        setCustomCorrectorWords(new Set(memory.customWords));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [file?.path, writingAssists?.correctorMemory]);

  useEffect(() => {
    if (review) {
      setTightenReview(null);
      setProvisionalTightenRange(null);
      setActiveWritingIssue(null);
    }
  }, [review]);

  useEffect(() => {
    setActiveWritingIssue(null);
  }, [value]);

  useEffect(() => {
    const target = contentSearchRevealTarget;

    if (
      !target ||
      !editorView ||
      file?.path !== target.filePath ||
      handledContentRevealRequestIdRef.current === target.requestId
    ) {
      return;
    }

    const plan = resolveContentSearchReveal(editorView.state, target);
    handledContentRevealRequestIdRef.current = target.requestId;
    editorView.dispatch({
      selection: plan.kind === "exact" ? { anchor: plan.from, head: plan.to } : { anchor: plan.from },
      effects: EditorView.scrollIntoView(plan.kind === "exact" ? plan.to : plan.from, { y: "center" })
    });
    editorView.focus();
    onContentSearchRevealHandled?.(target.requestId);
  }, [contentSearchRevealTarget, editorView, file?.path, onContentSearchRevealHandled, value]);

  useEffect(() => {
    if (!activeWritingIssue) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const firstButton = writingIssuePopoverRef.current?.querySelector("button");
      firstButton instanceof HTMLButtonElement ? firstButton.focus() : writingIssuePopoverRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeWritingIssue]);

  useEffect(() => {
    if (!activeWritingIssue) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (writingIssuePopoverRef.current?.contains(target)) {
        return;
      }

      if (target instanceof Element && target.closest(".cm-writing-corrector-mark")) {
        return;
      }

      setActiveWritingIssue(null);
    };

    window.addEventListener("pointerdown", handlePointerDown, true);

    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [activeWritingIssue]);

  const reportActiveSelection = useCallback((update: ViewUpdate) => {
    const selection = update.state.selection.main;
    const next =
      selection.empty || !update.state.sliceDoc(selection.from, selection.to).trim()
        ? null
        : { from: selection.from, to: selection.to };
    const previous = lastReportedSelectionRef.current;

    if ((previous === null) !== (next === null) || previous?.from !== next?.from || previous?.to !== next?.to) {
      lastReportedSelectionRef.current = next;
      activeSelectionCallbackRef.current?.(next);
    }
  }, []);

  const tightenReviewHunk = useMemo<DisplayReviewHunk | null>(() => {
    if (!tightenReview) {
      return null;
    }

    const oldStartLine = lineNumberAt(value, tightenReview.range.from);
    const oldLines = splitReviewLines(tightenReview.range.originalText);
    const newLines = splitReviewLines(tightenReview.rewrite);
    const oldLineCount = Math.max(1, oldLines.length);
    const displayOldEndLine = oldStartLine + oldLineCount - 1;

    return {
      id: "tighten-inline-review",
      status: "pending",
      anchorLine: displayOldEndLine,
      oldStartLine,
      oldLines,
      newLines,
      displayOldStartLine: oldStartLine,
      displayOldEndLine,
      displayAnchorLine: displayOldEndLine
    };
  }, [tightenReview, value]);
  const tightenChangedLineRanges = useMemo(
    () => (tightenReviewHunk ? [{ from: tightenReviewHunk.displayOldStartLine, to: tightenReviewHunk.displayOldEndLine }] : []),
    [tightenReviewHunk]
  );
  const blockedLineRanges = useMemo(
    () => (review?.mode === "edit_file" ? editReviewDisplay?.changedLineRanges : tightenChangedLineRanges),
    [editReviewDisplay?.changedLineRanges, review?.mode, tightenChangedLineRanges]
  );

  useEffect(() => {
    if (!file || !writingAssists?.correctorEnabled || writingAssists.language !== "en" || review || readOnly) {
      setWritingIssues((currentIssues) => (currentIssues.length === 0 ? currentIssues : []));
      return;
    }

    let cancelled = false;
    const documentText = value;
    const timer = window.setTimeout(() => {
      void detectWritingIssues(documentText, {
        language: writingAssists.language,
        cursor: null,
        blockedLineRanges,
        ignoredIssueKeys: ignoredWritingIssueKeys,
        customWords: customCorrectorWords
      })
        .then((issues) => {
          if (!cancelled) {
            setWritingIssues(issues);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setWritingIssues([]);
          }
        });
    }, 700);

    setWritingIssues((currentIssues) => (currentIssues.length === 0 ? currentIssues : []));

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    blockedLineRanges,
    customCorrectorWords,
    file?.path,
    ignoredWritingIssueKeys,
    readOnly,
    review,
    value,
    writingAssists?.correctorEnabled,
    writingAssists?.language
  ]);

  const openWritingIssue = useCallback((issue: WritingIssue, view: EditorView) => {
    const coords = view.coordsAtPos(issue.from);
    const surface = editorSurfaceRef.current;

    if (!coords || !surface) {
      return;
    }

    const surfaceRect = surface.getBoundingClientRect();
    setActiveWritingIssue({
      issue,
      left: Math.max(12, coords.left - surfaceRect.left + surface.scrollLeft),
      top: Math.max(12, coords.bottom - surfaceRect.top + surface.scrollTop + 8)
    });
  }, []);
  const closeWritingIssue = useCallback(() => {
    setActiveWritingIssue(null);
    editorView?.focus();
  }, [editorView]);
  const applyWritingSuggestion = useCallback(
    (issue: WritingIssue, replacement: string) => {
      if (!editorView) {
        return;
      }

      if (editorView.state.sliceDoc(issue.from, issue.to) !== issue.originalText) {
        setActiveWritingIssue(null);
        return;
      }

      editorView.dispatch({
        changes: { from: issue.from, to: issue.to, insert: replacement },
        selection: { anchor: issue.from + replacement.length }
      });
      setActiveWritingIssue(null);
      editorView.focus();
    },
    [editorView]
  );
  const ignoreWritingIssue = useCallback(
    (issue: WritingIssue) => {
      const positionKey = writingIssueKey(issue);
      const fingerprint = writingIssueFingerprint(issue, writingAssists?.language ?? "en");
      const documentPath = file?.path;

      setIgnoredWritingIssueKeys((currentKeys) => {
        const nextKeys = new Set(currentKeys);
        nextKeys.add(positionKey);
        nextKeys.add(fingerprint);
        return nextKeys;
      });
      setActiveWritingIssue(null);
      editorView?.focus();

      if (!documentPath) {
        return;
      }

      void writingAssists?.correctorMemory
        ?.ignoreIssue(fingerprint)
        .then((memory) => {
          if (file?.path !== documentPath) {
            return;
          }

          setIgnoredWritingIssueKeys((currentKeys) => {
            const nextKeys = new Set(currentKeys);
            memory.ignoredIssueFingerprints.forEach((ignoredFingerprint) => nextKeys.add(ignoredFingerprint));
            return nextKeys;
          });
        })
        .catch(() => undefined);
    },
    [editorView, file?.path, writingAssists]
  );
  const addCorrectorWord = useCallback(
    (issue: WritingIssue) => {
      const word = issue.originalText.toLowerCase();
      const documentPath = file?.path;

      setCustomCorrectorWords((currentWords) => {
        const nextWords = new Set(currentWords);
        nextWords.add(word);
        return nextWords;
      });
      setActiveWritingIssue(null);
      editorView?.focus();

      if (!documentPath) {
        return;
      }

      void writingAssists?.correctorMemory
        ?.addDictionaryWord(issue.originalText)
        .then(({ customWords }) => {
          if (file?.path !== documentPath) {
            return;
          }

          setCustomCorrectorWords(new Set(customWords));
        })
        .catch(() => undefined);
    },
    [editorView, file?.path, writingAssists]
  );
  const updateAutocompleteStatusAnchor = useCallback(() => {
    const view = editorView;
    const surface = editorSurfaceRef.current;

    if (!view || !surface) {
      setAutocompleteStatusAnchor(null);
      return;
    }

    const selection = view.state.selection.main;

    if (!selection.empty) {
      setAutocompleteStatusAnchor(null);
      return;
    }

    const coords = view.coordsAtPos(selection.head);

    if (!coords) {
      setAutocompleteStatusAnchor(null);
      return;
    }

    const surfaceRect = surface.getBoundingClientRect();
    const maxLeft = surface.scrollLeft + surface.clientWidth - 340;
    setAutocompleteStatusAnchor({
      left: Math.max(12, Math.min(maxLeft, coords.left - surfaceRect.left + surface.scrollLeft)),
      top: Math.max(12, coords.bottom - surfaceRect.top + surface.scrollTop + 10)
    });
  }, [editorView]);
  const handleAutocompleteStatusChange = useCallback(
    (status: IdeaAutocompleteStatus) => {
      setAutocompleteStatus(status);

      if (status.state === "requesting" || status.state === "failed") {
        updateAutocompleteStatusAnchor();
      } else {
        setAutocompleteStatusAnchor(null);
      }
    },
    [updateAutocompleteStatusAnchor]
  );
  const autocompleteStatusMessage = useMemo(() => {
    if (!writingAssists?.autocompleteEnabled) {
      return null;
    }

    if (autocompleteStatus.state === "requesting") {
      return writingAssists.labels.autocomplete.working;
    }

    if (autocompleteStatus.state !== "failed") {
      return null;
    }

    switch (autocompleteStatus.reason) {
      case "no_key":
        return writingAssists.labels.autocomplete.noProvider;
      case "invalid_api_key":
        return writingAssists.labels.autocomplete.invalidApiKey;
      case "rate_limited":
        return writingAssists.labels.autocomplete.rateLimited;
      case "too_long":
        return writingAssists.labels.autocomplete.tooLong;
      case "timeout":
        return writingAssists.labels.autocomplete.timeout;
      case "no_suggestion":
        return writingAssists.labels.autocomplete.noSuggestion;
      case "disabled":
      case "empty":
        return writingAssists.labels.autocomplete.unavailableInDocument;
      case "provider":
      case "aborted":
      case "untrusted":
        return writingAssists.labels.autocomplete.unavailable;
    }
  }, [autocompleteStatus, writingAssists]);

  const extensions = useMemo(
    () => {
      const nextExtensions = [
        markdown(),
        markdownEscapeHighlight,
        proseEnterExtension(),
        EditorView.lineWrapping,
        editorTheme,
        EditorView.updateListener.of(reportActiveSelection),
        visualMarkdown({
          documentPath: file?.path ?? "",
          blockedLineRanges,
          initialEditorFocused: editorView?.hasFocus ?? false,
          labels: labels.visualMarkdown,
          onOpenLink
        })
      ];

      if (file && selectionComments) {
        nextExtensions.push(
          selectionCommentsExtension({
            documentPath: file.path,
            ranges: selectionCommentRanges,
            provisionalRange: provisionalCommentRange,
            provisionalTightenRange,
            onPositionsChanged: selectionComments.onPositionsChanged,
            onFullReplacement: selectionComments.onFullReplacement,
            onMouseUpSelection: handleOverlayMouseUp,
            onMouseMove: handleOverlayMouseMove,
            onEditorUpdate: handleOverlayEditorUpdate,
            onCommentShortcut: handleOverlayShortcut,
            onTightenShortcut: handleOverlayTightenShortcut,
            onEscape: handleOverlayEscape
          })
        );
      }

      if (file && writingAssists?.correctorEnabled && !review && !readOnly) {
        nextExtensions.push(
          ...writingCorrectorExtension({
            enabled: true,
            issues: writingIssues,
            onOpenIssue: openWritingIssue
          })
        );
      }

      if (
        file &&
        writingAssists?.autocompleteEnabled &&
        writingAssists.workspaceSessionId &&
        writingAssists.documentRelativePath &&
        !activeWritingIssue &&
        !review &&
        !readOnly
      ) {
        nextExtensions.push(
          ...ideaAutocompleteExtension({
            enabled: true,
            language: writingAssists.language,
            workspaceSessionId: writingAssists.workspaceSessionId,
            documentRelativePath: writingAssists.documentRelativePath,
            documentTitle: file.name.replace(/\.(md|markdown|mdown|mkd)$/i, ""),
            autocompleteApiFallbackEnabled: writingAssists.autocompleteApiFallbackEnabled,
            blockedLineRanges,
            requestAutocomplete: writingAssists.autocompleteIdea,
            cancelAutocomplete: writingAssists.cancelAutocompleteIdea,
            onStatusChange: handleAutocompleteStatusChange
          })
        );
      }

      if (review?.mode === "edit_file" && editReviewDisplay && !editReviewDisplay.stale) {
        if (review.readOnly) {
          nextExtensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false));
        }

        nextExtensions.push(
          aiReviewExtension({
            mode: "edit_file",
            hunks: editReviewDisplay.hunks,
            activeHunkId: null,
            createLineCount: 0,
            onAcceptHunk: review.hideHunkActions ? undefined : review.onAcceptHunk,
            onRejectHunk: review.hideHunkActions ? undefined : review.onRejectHunk,
            onOpenLink,
            renderInsertedAsSource: true,
            labels: {
              acceptChange: review.labels.acceptChange,
              rejectChange: review.labels.rejectChange
            }
          })
        );
      } else if (tightenReviewHunk) {
        nextExtensions.push(
          aiReviewExtension({
            mode: "edit_file",
            hunks: [tightenReviewHunk],
            activeHunkId: "tighten-inline-review",
            createLineCount: 0,
            renderInsertedAsSource: true,
            onAcceptHunk: handleAcceptTightenReview,
            onRejectHunk: handleRejectTightenReview,
            onOpenLink,
            labels: {
              acceptChange: labels.reviewToolbar.acceptChange,
              rejectChange: labels.reviewToolbar.rejectChange
            }
          })
        );
      }

      if (review?.mode === "create_file" || review?.mode === "delete_file") {
        nextExtensions.push(
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          aiReviewExtension({
            mode: review.mode,
            hunks: [],
            activeHunkId: null,
            createLineCount: Math.max(1, review.currentContent.split(/\r\n|\r|\n/).length),
            labels: {}
          })
        );
      } else {
        nextExtensions.push(
          imageDropPasteExtension({
            insertImage: onInsertImage,
            insertImageReference: onInsertImageReference,
            workspaceSessionId: writingAssists?.workspaceSessionId
          })
        );
      }

      return nextExtensions;
    },
    [
      editReviewDisplay,
      blockedLineRanges,
      activeWritingIssue,
      editorTheme,
      editorView,
      file?.path,
      handleAcceptTightenReview,
      handleOverlayEditorUpdate,
      handleOverlayEscape,
      handleOverlayMouseMove,
      handleOverlayMouseUp,
      handleOverlayShortcut,
      handleOverlayTightenShortcut,
      handleRejectTightenReview,
      handleAutocompleteStatusChange,
      ignoredWritingIssueKeys,
      labels.visualMarkdown,
      labels.reviewToolbar.acceptChange,
      labels.reviewToolbar.rejectChange,
      onInsertImage,
      onInsertImageReference,
      onOpenLink,
      openWritingIssue,
      provisionalCommentRange,
      provisionalTightenRange,
      reportActiveSelection,
      review,
      selectionCommentRanges,
      selectionComments,
      tightenReviewHunk,
      writingAssists,
      writingIssues,
      customCorrectorWords,
      readOnly
    ]
  );

  if (!file) {
    return (
      <main className="editor-shell">
        <div className="editor-empty">
          <ClipMark size={76} className="editor-empty__mark" />
          <h1>{labels.emptyTitle}</h1>
          {onCreateDocument ? (
            <button type="button" className="editor-empty__action" onClick={onCreateDocument}>
              <FilePlus size={16} />
              {labels.emptyNewDocument}
            </button>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <main className="editor-shell">
      {review ? (
        <div className="editor-review-toolbar">
          {review.mode === "edit_file" ? (
            <>
              <div className="editor-review-title">
                <span className="editor-review-path">{review.file.relativePath}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {editReviewDisplay?.stale || review.file.status === "stale"
                    ? review.labels.stale
                    : review.labels.changes(unresolvedHunks.length)}
                </span>
              </div>
              <div className="editor-review-actions">
                <button
                  type="button"
                  disabled={Boolean(editReviewDisplay?.stale) || unresolvedHunks.length === 0}
                  onClick={review.onAcceptFile}
                >
                  {review.labels.acceptAll}
                </button>
                <button type="button" onClick={review.onRejectFile}>
                  {(review.file.hunks ?? []).some((hunk) => hunk.status === "accepted")
                    ? review.labels.rejectRemaining
                    : review.labels.rejectAll}
                </button>
              </div>
            </>
          ) : review.mode === "create_file" ? (
            <>
              <div className="editor-review-title">
                <span className="editor-review-path">{review.labels.pendingDocument(review.file.relativePath)}</span>
              </div>
              <div className="editor-review-actions">
                <button type="button" onClick={review.onAcceptFile}>
                  {review.labels.create}
                </button>
                <button type="button" onClick={review.onRejectFile}>
                  {review.labels.discard}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="editor-review-title">
                <span className="editor-review-path">
                  {review.labels.pendingDeleteDocument(review.file.relativePath)}
                </span>
              </div>
              <div className="editor-review-actions">
                <button type="button" onClick={review.onAcceptFile}>
                  {review.labels.delete}
                </button>
                <button type="button" onClick={review.onRejectFile}>
                  {review.labels.discard}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
      <div className="editor-surface" ref={editorSurfaceRef}>
        <CodeMirror
          value={value}
          basicSetup={{
            foldGutter: false,
            lineNumbers: false,
            highlightActiveLineGutter: false,
            autocompletion: false,
            drawSelection: false,
            searchKeymap: true,
            // lintKeymap binds Mod-Shift-m to openLintPanel; the selection
            // comment shortcut owns that combination.
            lintKeymap: false
          }}
          extensions={extensions}
          onChange={readOnly ? undefined : onChange}
          onCreateEditor={(view) => {
            setEditorView(view);
            onEditorViewChange?.(view);
          }}
        />
        {selectionComments && !review ? (
          <SelectionCommentsOverlay
            view={editorView}
            comments={selectionComments.comments.filter((comment) => comment.status === "pending")}
            labels={labels.selectionComments}
            apiRef={overlayApiRef}
            onCreateComment={selectionComments.onCreateComment}
            onUpdateComment={selectionComments.onUpdateComment}
            onDeleteComment={selectionComments.onDeleteComment}
            onProvisionalRangeChange={setProvisionalCommentRange}
            tighten={
              tighten && file
                ? {
                    enabled: tighten.enabled,
                    minChars: tighten.minChars,
                    maxChars: tighten.maxChars,
                    labels: tighten.labels,
                    run: tighten.run,
                    cancel: tighten.cancel,
                    filePath: file.path,
                    onProposedRangeChange: setProvisionalTightenRange,
                    reviewActive: Boolean(tightenReview),
                    onReviewReady: setTightenReview,
                    onRejectReview: handleRejectTightenReview
                  }
                : undefined
            }
          />
        ) : null}
        {activeWritingIssue && writingAssists ? (
          <div
            className="writing-corrector-popover"
            role="dialog"
            aria-label={writingAssists.labels.corrector.openActions}
            style={{ left: activeWritingIssue.left, top: activeWritingIssue.top }}
            ref={writingIssuePopoverRef}
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeWritingIssue();
              }
            }}
          >
            {activeWritingIssue.issue.suggestions.length === 0 ? (
              <p className="writing-corrector-message">{activeWritingIssue.issue.message}</p>
            ) : null}
            <div className="writing-corrector-actions">
              {activeWritingIssue.issue.suggestions.slice(0, 5).map((suggestion) => (
                <button
                  key={`${suggestion.label}:${suggestion.replacement}`}
                  type="button"
                  className="writing-corrector-action"
                  onClick={() => applyWritingSuggestion(activeWritingIssue.issue, suggestion.replacement)}
                >
                  {suggestion.label || writingAssists.labels.corrector.apply}
                </button>
              ))}
            </div>
            <div className="writing-corrector-secondary-actions">
              {activeWritingIssue.issue.canIgnore ? (
                <button
                  type="button"
                  className="writing-corrector-secondary-action"
                  onClick={() => ignoreWritingIssue(activeWritingIssue.issue)}
                >
                  {writingAssists.labels.corrector.ignore}
                </button>
              ) : null}
              {activeWritingIssue.issue.canAddToDictionary ? (
                <button
                  type="button"
                  className="writing-corrector-secondary-action"
                  onClick={() => addCorrectorWord(activeWritingIssue.issue)}
                >
                  {writingAssists.labels.corrector.addToDictionary}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {autocompleteStatusMessage ? (
          <div
            className={autocompleteStatusAnchor ? "editor-autocomplete-status is-anchored" : "editor-autocomplete-status"}
            role="status"
            style={autocompleteStatusAnchor ? { left: autocompleteStatusAnchor.left, top: autocompleteStatusAnchor.top } : undefined}
          >
            {autocompleteStatusMessage}
          </div>
        ) : null}
      </div>
    </main>
  );
}
