import { FileText, LoaderCircle, Mic, Send, Square, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type Ref } from "react";
import {
  contextAttachmentDisplayLabels,
  contextFileBasename,
  findActiveMentionToken,
  manualContextAttachmentLimit,
  normalizeRelativePath,
  rankMarkdownContextDocuments,
  replaceMentionTokenWithPath,
  type AssistantContextAttachmentChip,
  type AssistantContextAttachmentSource,
  type MarkdownContextDocument
} from "../../assistant/contextAttachments";
import type { DictationState } from "../../assistant/useDictation";
import type { AppStrings } from "../../i18n/strings";
import {
  AssistantSelectionCommentsChip,
  type AssistantSelectionCommentItem
} from "./AssistantSelectionComments";

export interface AssistantComposerSelectionComments {
  count: number;
  documentName: string;
  documentPath: string;
  items: AssistantSelectionCommentItem[];
  onDiscardItem: (id: string) => void;
  onSelectItem: (id: string) => void;
}

interface AssistantComposerProps {
  contextAttachments: AssistantContextAttachmentChip[];
  contextDocuments: MarkdownContextDocument[];
  contextDocumentsTruncated: boolean;
  contextFileName: string | null;
  selectionChip?: { label: string; tooltip: string } | null;
  onDismissSelectionChip?: () => void;
  contextFilePath: string | null;
  contextStatusText: string | null;
  dictation: DictationState;
  highlightedContextAttachmentId: string | null;
  labels: AppStrings["assistant"];
  prompt: string;
  promptPlaceholder: string;
  runningRunId: string | null;
  selectionComments?: AssistantComposerSelectionComments;
  sendDisabled: boolean;
  sendDisabledReason: string | undefined;
  textareaRef: Ref<HTMLTextAreaElement>;
  onAddContextAttachment: (relativePath: string, source: AssistantContextAttachmentSource) => boolean;
  onAsk: () => void;
  onCancel: () => void;
  onPromptChange: (value: string) => void;
  onRemoveContextAttachment: (attachmentId: string) => void;
  onRemoveLastContextAttachment: () => boolean;
}

function setForwardedTextareaRef(ref: Ref<HTMLTextAreaElement>, value: HTMLTextAreaElement | null) {
  if (typeof ref === "function") {
    ref(value);
    return;
  }

  if (ref) {
    (ref as { current: HTMLTextAreaElement | null }).current = value;
  }
}

function tokenKey(token: { start: number; end: number; query: string }) {
  return `${token.start}:${token.end}:${token.query}`;
}

export function AssistantComposer({
  contextAttachments,
  contextDocuments,
  contextDocumentsTruncated,
  contextFileName,
  selectionChip,
  onDismissSelectionChip,
  contextFilePath,
  contextStatusText,
  dictation,
  highlightedContextAttachmentId,
  labels,
  prompt,
  promptPlaceholder,
  runningRunId,
  selectionComments,
  sendDisabled,
  sendDisabledReason,
  textareaRef,
  onAddContextAttachment,
  onAsk,
  onCancel,
  onPromptChange,
  onRemoveContextAttachment,
  onRemoveLastContextAttachment
}: AssistantComposerProps) {
  const textareaNodeRef = useRef<HTMLTextAreaElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const listboxId = useId();
  const [caret, setCaret] = useState(prompt.length);
  const [dismissedTokenKey, setDismissedTokenKey] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const activeToken = useMemo(() => findActiveMentionToken(prompt, caret), [caret, prompt]);
  const activeTokenKey = activeToken ? tokenKey(activeToken) : null;
  const suggestions = useMemo(
    () =>
      activeToken
        ? rankMarkdownContextDocuments(contextDocuments, {
            query: activeToken.query,
            activeRelativePath: contextFilePath,
            limit: 8
          })
        : [],
    [activeToken, contextDocuments, contextFilePath]
  );
  const pickerOpen = Boolean(activeToken && activeTokenKey !== dismissedTokenKey && !runningRunId);
  const selectedSuggestion = pickerOpen ? suggestions[highlightedIndex] : undefined;
  const selectedOptionId = selectedSuggestion ? `${listboxId}-option-${highlightedIndex}` : undefined;
  const manualAttachmentLimitReached = contextAttachments.length >= manualContextAttachmentLimit;
  const displayLabels = useMemo(
    () =>
      contextAttachmentDisplayLabels([
        ...(contextFilePath ? [contextFilePath] : []),
        ...contextAttachments.map((attachment) => attachment.relativePath)
      ]),
    [contextAttachments, contextFilePath]
  );
  const contextFileDisplayLabel = contextFilePath
    ? displayLabels.get(normalizeRelativePath(contextFilePath)) ?? contextFileName
    : contextFileName;
  const liveText =
    contextStatusText ??
    (pickerOpen && suggestions.length === 0 ? labels.context.noMatchingMarkdown : "");

  useEffect(() => {
    setHighlightedIndex(0);
  }, [activeTokenKey, suggestions.map((suggestion) => suggestion.relativePath).join("|")]);

  useEffect(() => {
    if (!pickerOpen) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (formRef.current?.contains(event.target as Node)) {
        return;
      }

      if (activeTokenKey) {
        setDismissedTokenKey(activeTokenKey);
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [activeTokenKey, pickerOpen]);

  const updateCaretFromTextarea = (textarea: HTMLTextAreaElement) => {
    setCaret(textarea.selectionStart ?? textarea.value.length);
  };

  const restoreTextareaCaret = (nextCaret: number) => {
    window.requestAnimationFrame(() => {
      const textarea = textareaNodeRef.current;

      if (!textarea) {
        return;
      }

      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
      setCaret(nextCaret);
    });
  };

  const closePicker = () => {
    if (activeTokenKey) {
      setDismissedTokenKey(activeTokenKey);
    }
  };

  const selectSuggestion = (document: MarkdownContextDocument | undefined) => {
    if (!document || !activeToken) {
      return;
    }

    const attached = onAddContextAttachment(document.relativePath, "mention_picker");

    if (!attached) {
      return;
    }

    const replacement = replaceMentionTokenWithPath(prompt, activeToken, document.relativePath);
    onPromptChange(replacement.text);
    setDismissedTokenKey(null);
    restoreTextareaCaret(replacement.caret);
  };

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (pickerOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightedIndex((index) => (suggestions.length > 0 ? (index + 1) % suggestions.length : 0));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedIndex((index) => (suggestions.length > 0 ? (index - 1 + suggestions.length) % suggestions.length : 0));
        return;
      }

      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault();
        selectSuggestion(selectedSuggestion);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closePicker();
        return;
      }

      if (event.key === " ") {
        closePicker();
        return;
      }
    }

    if (
      event.key === "Backspace" &&
      prompt.length === 0 &&
      event.currentTarget.selectionStart === 0 &&
      event.currentTarget.selectionEnd === 0
    ) {
      if (onRemoveLastContextAttachment()) {
        event.preventDefault();
      }

      return;
    }

    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!sendDisabled) {
        void onAsk();
      }
    }
  };

  return (
    <form
      ref={formRef}
      className="assistant-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (!sendDisabled) {
          void onAsk();
        }
      }}
    >
      <div className="assistant-composer-control">
        <textarea
          ref={(node) => {
            textareaNodeRef.current = node;
            setForwardedTextareaRef(textareaRef, node);
          }}
          value={prompt}
          placeholder={promptPlaceholder}
          rows={1}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={pickerOpen}
          aria-controls={pickerOpen ? listboxId : undefined}
          aria-activedescendant={pickerOpen ? selectedOptionId : undefined}
          onChange={(event) => {
            onPromptChange(event.target.value);
            updateCaretFromTextarea(event.target);
          }}
          onClick={(event) => updateCaretFromTextarea(event.currentTarget)}
          onKeyDown={handleTextareaKeyDown}
          onKeyUp={(event) => updateCaretFromTextarea(event.currentTarget)}
          onSelect={(event) => updateCaretFromTextarea(event.currentTarget)}
        />
        {pickerOpen ? (
          <div
            id={listboxId}
            className={`assistant-context-picker${manualAttachmentLimitReached ? " is-disabled" : ""}`}
            role="listbox"
            aria-label={labels.context.suggestionsLabel}
          >
            {suggestions.length > 0 ? (
              suggestions.map((suggestion, index) => {
                const optionId = `${listboxId}-option-${index}`;
                const isSelected = index === highlightedIndex;

                return (
                  <button
                    key={suggestion.relativePath}
                    id={optionId}
                    type="button"
                    className={`assistant-context-suggestion${isSelected ? " is-selected" : ""}`}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={manualAttachmentLimitReached}
                    aria-label={labels.context.attachSuggestion(suggestion.relativePath)}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => selectSuggestion(suggestion)}
                  >
                    <FileText size={15} strokeWidth={1.6} />
                    <span className="assistant-context-suggestion-text">
                      <strong>{contextFileBasename(suggestion.relativePath)}</strong>
                      <small>{suggestion.relativePath}</small>
                    </span>
                  </button>
                );
              })
            ) : (
              <div
                id={`${listboxId}-option-empty`}
                className="assistant-context-empty-option"
                role="option"
                aria-disabled="true"
              >
                {labels.context.noMatchingMarkdown}
              </div>
            )}
            {manualAttachmentLimitReached ? (
              <div className="assistant-context-picker-footer">
                {labels.context.maxManualAttachments(manualContextAttachmentLimit)}
              </div>
            ) : contextDocumentsTruncated ? (
              <div className="assistant-context-picker-footer">{labels.context.keepTypingToNarrow}</div>
            ) : null}
          </div>
        ) : null}
        <div className="assistant-composer-actions">
          <button
            type="button"
            className={`assistant-dictation-button${dictation.status === "recording" ? " is-recording" : ""}`}
            aria-label={
              dictation.status === "recording"
                ? labels.dictation.stopRecording
                : dictation.status === "transcribing"
                  ? labels.dictation.transcribing
                  : labels.dictation.dictate
            }
            data-tooltip={
              !dictation.isSupported
                ? labels.dictation.unsupported
                : dictation.status === "recording"
                  ? labels.dictation.stopRecording
                  : dictation.status === "transcribing"
                    ? labels.dictation.transcribing
                    : labels.dictation.dictate
            }
            disabled={!dictation.isSupported || dictation.status === "transcribing" || Boolean(runningRunId)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={dictation.toggle}
          >
            {dictation.status === "transcribing" ? (
              <LoaderCircle className="assistant-dictation-spinner" size={15} />
            ) : dictation.status === "recording" ? (
              <Square size={15} />
            ) : (
              <Mic size={15} />
            )}
          </button>
          {runningRunId ? (
            <button
              type="button"
              aria-label={labels.stop}
              data-tooltip={labels.stop}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void onCancel()}
            >
              <Square size={15} />
            </button>
          ) : (
            <button
              type="submit"
              aria-label={labels.send}
              data-tooltip={sendDisabledReason ?? labels.send}
              disabled={sendDisabled}
            >
              <Send size={15} />
            </button>
          )}
        </div>
        <div className="assistant-context-chips" aria-label={labels.context.label}>
          <span
            aria-label={labels.context.autoTooltip}
            className="assistant-context-chip"
            data-tooltip={labels.context.autoTooltip}
            tabIndex={0}
          >
            {labels.context.auto}
          </span>
          {contextFilePath && contextFileDisplayLabel ? (
            <span
              className="assistant-context-chip assistant-context-file-chip"
              aria-label={labels.context.currentFileTooltip(contextFilePath)}
              data-tooltip={labels.context.currentFileTooltip(contextFilePath)}
              tabIndex={0}
            >
              <span className="assistant-context-chip-label">{contextFileDisplayLabel}</span>
            </span>
          ) : null}
          {selectionChip ? (
            <span
              className="assistant-context-chip assistant-context-manual-chip"
              aria-label={selectionChip.tooltip}
              data-tooltip={selectionChip.tooltip}
              tabIndex={0}
            >
              <span className="assistant-context-chip-label">{selectionChip.label}</span>
              <button
                type="button"
                className="assistant-context-chip-remove"
                aria-label={labels.context.removeSelection}
                onClick={() => onDismissSelectionChip?.()}
              >
                ×
              </button>
            </span>
          ) : null}
          {selectionComments && selectionComments.count > 0 ? (
            <AssistantSelectionCommentsChip
              count={selectionComments.count}
              documentName={selectionComments.documentName}
              documentPath={selectionComments.documentPath}
              items={selectionComments.items}
              labels={labels.selectionComments}
              onDiscardItem={selectionComments.onDiscardItem}
              onSelectItem={selectionComments.onSelectItem}
            />
          ) : null}
          {contextAttachments.map((attachment) => {
            const normalizedPath = normalizeRelativePath(attachment.relativePath);
            const label = displayLabels.get(normalizedPath) ?? attachment.label;

            return (
              <span
                key={attachment.id}
                className={`assistant-context-chip assistant-context-manual-chip${
                  highlightedContextAttachmentId === attachment.id ? " is-emphasized" : ""
                }`}
                data-tooltip={labels.context.manualTooltip(attachment.relativePath)}
              >
                <span className="assistant-context-chip-label">{label}</span>
                <button
                  type="button"
                  className="assistant-context-chip-remove"
                  aria-label={labels.context.remove(attachment.relativePath)}
                  data-tooltip={labels.context.remove(attachment.relativePath)}
                  onClick={() => onRemoveContextAttachment(attachment.id)}
                >
                  <X size={12} />
                </button>
              </span>
            );
          })}
        </div>
        <div className="assistant-context-live" aria-live="polite" aria-atomic="true">
          {liveText}
        </div>
        {dictation.error || dictation.statusText ? (
          <div
            className={`assistant-dictation-message${dictation.error ? " is-error" : ""}`}
            aria-live="polite"
          >
            {dictation.error ?? dictation.statusText}
          </div>
        ) : null}
      </div>
    </form>
  );
}
