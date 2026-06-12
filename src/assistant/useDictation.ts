import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { AppStrings } from "../i18n/strings";
import type { AgentError } from "../types/iliad";
import { agentErrorMessage } from "./assistantUtils";

const MAX_RECORDING_MS = 45_000;
const MAX_RECORDING_BYTES = 24 * 1024 * 1024;
const RECORDING_TIMESLICE_MS = 1000;

const DICTATION_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4"
] as const;

export interface DictationSelection {
  value: string;
  start: number;
  end: number;
}

export interface DictationPromptResult {
  value: string;
  caret: number;
}

type DictationStatus = "idle" | "recording" | "transcribing";
type RecordingCompletion =
  | { mode: "transcribe" }
  | { mode: "cancel" }
  | { mode: "error"; message: string };

type AgentTranscriptionResponse = {
  requestId: string;
  text: string;
  error?: AgentError | { userMessage?: string; code?: string } | string;
};

type AgentApiWithDictation = typeof window.iliad.agent & {
  transcribeAudio?: (request: {
    requestId: string;
    audio: ArrayBuffer;
    mimeType: string;
  }) => Promise<AgentTranscriptionResponse>;
};

interface UseDictationOptions {
  hasOpenAiApiKey: boolean;
  labels: AppStrings["assistant"];
  prompt: string;
  textareaRef: RefObject<HTMLTextAreaElement>;
  onMissingApiKey: () => void;
  setPrompt: Dispatch<SetStateAction<string>>;
}

export interface DictationState {
  error: string | null;
  isBusy: boolean;
  isSupported: boolean;
  mimeType: string | null;
  status: DictationStatus;
  statusText: string | null;
  cancel: () => void;
  clearError: () => void;
  toggle: () => void;
}

export function chooseDictationMimeType(
  recorderClass: Pick<typeof MediaRecorder, "isTypeSupported"> | undefined
) {
  if (!recorderClass?.isTypeSupported) {
    return null;
  }

  return DICTATION_MIME_TYPES.find((mimeType) => recorderClass.isTypeSupported(mimeType)) ?? null;
}

export function composePromptWithTranscript(
  currentPrompt: string,
  selection: DictationSelection | null,
  transcript: string
): DictationPromptResult {
  const text = transcript.trim();

  if (!text) {
    return { value: currentPrompt, caret: currentPrompt.length };
  }

  if (!currentPrompt) {
    return { value: text, caret: text.length };
  }

  if (!selection || currentPrompt !== selection.value) {
    return insertTextAtRange(currentPrompt, currentPrompt.length, currentPrompt.length, text);
  }

  return insertTextAtRange(currentPrompt, selection.start, selection.end, text);
}

export function localRecordingCapErrorMessage(labels: AppStrings["assistant"]["dictation"]) {
  return labels.errors.recordingTooLong;
}

function insertTextAtRange(value: string, start: number, end: number, insertedText: string): DictationPromptResult {
  const safeStart = Math.max(0, Math.min(start, value.length));
  const safeEnd = Math.max(safeStart, Math.min(end, value.length));
  const before = value.slice(0, safeStart);
  const after = value.slice(safeEnd);
  const leftGap = needsLeftGap(before, insertedText) ? " " : "";
  const rightGap = needsRightGap(insertedText, after) ? " " : "";
  const nextValue = `${before}${leftGap}${insertedText}${rightGap}${after}`;

  return {
    value: nextValue,
    caret: before.length + leftGap.length + insertedText.length
  };
}

function needsLeftGap(before: string, insertedText: string) {
  return Boolean(before && insertedText && !/\s$/.test(before) && !/^[,.;:!?)]/.test(insertedText));
}

function needsRightGap(insertedText: string, after: string) {
  return Boolean(insertedText && after && !/\s$/.test(insertedText) && !/^\s|^[,.;:!?)]/.test(after));
}

function dictationRequestId() {
  return `dictation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function permissionErrorMessage(error: unknown, labels: AppStrings["assistant"]["dictation"]) {
  if (error instanceof DOMException) {
    if (["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(error.name)) {
      return labels.errors.microphoneDenied;
    }
  }

  return labels.couldNotTranscribe;
}

function transcriptionErrorMessage(error: AgentTranscriptionResponse["error"], labels: AppStrings["assistant"]) {
  if (!error) {
    return labels.dictation.couldNotTranscribe;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error.code === "missing_api_key") {
    return labels.dictation.errors.missingApiKey;
  }

  if (isAgentError(error)) {
    return agentErrorMessage(labels, error);
  }

  return error.userMessage || labels.dictation.couldNotTranscribe;
}

function isAgentError(error: { userMessage?: string; code?: string }): error is AgentError {
  return typeof error.code === "string" && typeof (error as { retryable?: unknown }).retryable === "boolean";
}

export function useDictation({
  hasOpenAiApiKey,
  labels,
  prompt,
  textareaRef,
  onMissingApiKey,
  setPrompt
}: UseDictationOptions): DictationState {
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef<DictationStatus>("idle");
  const promptRef = useRef(prompt);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const bytesRef = useRef(0);
  const requestIdRef = useRef<string | null>(null);
  const selectionRef = useRef<DictationSelection | null>(null);
  const completionRef = useRef<RecordingCompletion | null>(null);
  const durationTimerRef = useRef<number | null>(null);

  const mimeType = useMemo(() => {
    if (typeof MediaRecorder === "undefined") {
      return null;
    }

    return chooseDictationMimeType(MediaRecorder);
  }, []);

  const isSupported = Boolean(
    mimeType &&
      typeof MediaRecorder !== "undefined" &&
      navigator.mediaDevices?.getUserMedia
  );

  useEffect(() => {
    promptRef.current = prompt;
  }, [prompt]);

  const setDictationStatus = useCallback((nextStatus: DictationStatus) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  const focusTextarea = useCallback(
    (caret?: number) => {
      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current;

        if (!textarea) {
          return;
        }

        textarea.focus();

        if (typeof caret === "number") {
          textarea.setSelectionRange(caret, caret);
        }
      });
    },
    [textareaRef]
  );

  const captureSelection = useCallback(() => {
    const textarea = textareaRef.current;
    const value = promptRef.current;

    selectionRef.current = {
      value,
      start: textarea?.selectionStart ?? value.length,
      end: textarea?.selectionEnd ?? value.length
    };
  }, [textareaRef]);

  const releaseRecording = useCallback(() => {
    if (durationTimerRef.current !== null) {
      window.clearTimeout(durationTimerRef.current);
      durationTimerRef.current = null;
    }

    const recorder = recorderRef.current;

    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
    }

    streamRef.current?.getTracks().forEach((track) => {
      track.onended = null;

      if (track.readyState !== "ended") {
        track.stop();
      }
    });
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    bytesRef.current = 0;
  }, []);

  const transcribeRecording = useCallback(
    async (requestId: string, recordingChunks: Blob[], recordingMimeType: string) => {
      if (!recordingChunks.length || recordingChunks.every((chunk) => chunk.size === 0)) {
        setError(labels.dictation.errors.noSpeechDetected);
        return;
      }

      setDictationStatus("transcribing");
      const audio = await new Blob(recordingChunks, { type: recordingMimeType }).arrayBuffer();

      if (requestIdRef.current !== requestId) {
        return;
      }

      const agent = window.iliad.agent as AgentApiWithDictation;

      if (typeof agent.transcribeAudio !== "function") {
        setError(labels.dictation.couldNotTranscribe);
        return;
      }

      const response = await agent.transcribeAudio({ requestId, audio, mimeType: recordingMimeType });

      if (requestIdRef.current !== requestId || response.requestId !== requestId) {
        return;
      }

      if (response.error) {
        if (typeof response.error !== "string" && response.error.code === "missing_api_key") {
          onMissingApiKey();
        }

        setError(transcriptionErrorMessage(response.error, labels));
        return;
      }

      const transcript = response.text.trim();

      if (!transcript) {
        setError(labels.dictation.errors.noSpeechDetected);
        return;
      }

      let nextCaret = transcript.length;
      setPrompt((current) => {
        const result = composePromptWithTranscript(current, selectionRef.current, transcript);
        nextCaret = result.caret;
        return result.value;
      });
      focusTextarea(nextCaret);
    },
    [focusTextarea, labels, onMissingApiKey, setDictationStatus, setPrompt]
  );

  const finishRecording = useCallback(
    (completion: RecordingCompletion) => {
      const recorder = recorderRef.current;

      completionRef.current = completion;

      if (!recorder || recorder.state === "inactive") {
        releaseRecording();
        requestIdRef.current = null;
        setDictationStatus("idle");

        if (completion.mode === "error") {
          setError(completion.message);
        }

        focusTextarea();
        return;
      }

      try {
        recorder.stop();
      } catch {
        releaseRecording();
        requestIdRef.current = null;
        setDictationStatus("idle");
        setError(completion.mode === "error" ? completion.message : labels.dictation.couldNotTranscribe);
        focusTextarea();
      }
    },
    [focusTextarea, labels.dictation.couldNotTranscribe, releaseRecording, setDictationStatus]
  );

  const stopAndTranscribe = useCallback(() => {
    if (statusRef.current !== "recording") {
      return;
    }

    captureSelection();
    setError(null);
    finishRecording({ mode: "transcribe" });
  }, [captureSelection, finishRecording]);

  const cancel = useCallback(() => {
    if (statusRef.current !== "recording") {
      return;
    }

    requestIdRef.current = null;
    finishRecording({ mode: "cancel" });
  }, [finishRecording]);

  const start = useCallback(async () => {
    if (statusRef.current !== "idle" || requestIdRef.current) {
      return;
    }

    setError(null);

    if (!hasOpenAiApiKey) {
      onMissingApiKey();
      setError(labels.dictation.errors.missingApiKey);
      focusTextarea();
      return;
    }

    if (!isSupported || !mimeType) {
      return;
    }

    captureSelection();
    const requestId = dictationRequestId();
    requestIdRef.current = requestId;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      if (requestIdRef.current !== requestId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const recorder = new MediaRecorder(stream, { mimeType });
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      bytesRef.current = 0;
      completionRef.current = null;

      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          if (statusRef.current === "recording" && completionRef.current === null) {
            finishRecording({ mode: "error", message: labels.dictation.couldNotTranscribe });
          }
        };
      });

      recorder.ondataavailable = (event) => {
        if (!event.data.size) {
          return;
        }

        chunksRef.current.push(event.data);
        bytesRef.current += event.data.size;

        if (bytesRef.current > MAX_RECORDING_BYTES) {
          finishRecording({ mode: "error", message: localRecordingCapErrorMessage(labels.dictation) });
        }
      };

      recorder.onerror = () => {
        finishRecording({ mode: "error", message: labels.dictation.couldNotTranscribe });
      };

      recorder.onstop = () => {
        const completion = completionRef.current ?? { mode: "cancel" };
        const recordingChunks = chunksRef.current;
        const recordingMimeType = mimeType;
        const completedRequestId = requestIdRef.current;

        releaseRecording();

        if (completion.mode === "cancel") {
          setDictationStatus("idle");
          focusTextarea();
          return;
        }

        if (completion.mode === "error" || !completedRequestId) {
          requestIdRef.current = null;
          setDictationStatus("idle");
          setError(completion.mode === "error" ? completion.message : labels.dictation.couldNotTranscribe);
          focusTextarea();
          return;
        }

        void transcribeRecording(completedRequestId, recordingChunks, recordingMimeType)
          .catch(() => {
            if (requestIdRef.current === completedRequestId) {
              setError(labels.dictation.couldNotTranscribe);
            }
          })
          .finally(() => {
            if (requestIdRef.current === completedRequestId) {
              requestIdRef.current = null;
              setDictationStatus("idle");
              focusTextarea();
            }
          });
      };

      recorder.start(RECORDING_TIMESLICE_MS);
      setDictationStatus("recording");
      focusTextarea();
      durationTimerRef.current = window.setTimeout(() => {
        finishRecording({ mode: "error", message: localRecordingCapErrorMessage(labels.dictation) });
      }, MAX_RECORDING_MS);
    } catch (startError) {
      releaseRecording();
      requestIdRef.current = null;
      setDictationStatus("idle");
      setError(permissionErrorMessage(startError, labels.dictation));
      focusTextarea();
    }
  }, [
    captureSelection,
    finishRecording,
    focusTextarea,
    hasOpenAiApiKey,
    isSupported,
    labels,
    mimeType,
    onMissingApiKey,
    releaseRecording,
    setDictationStatus,
    transcribeRecording
  ]);

  const toggle = useCallback(() => {
    if (statusRef.current === "recording") {
      stopAndTranscribe();
      return;
    }

    if (statusRef.current === "idle") {
      void start();
    }
  }, [start, stopAndTranscribe]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && statusRef.current === "recording") {
        event.preventDefault();
        cancel();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [cancel]);

  useEffect(() => {
    return () => {
      requestIdRef.current = null;
      releaseRecording();
    };
  }, [releaseRecording]);

  return {
    error,
    isBusy: status === "recording" || status === "transcribing",
    isSupported,
    mimeType,
    status,
    statusText:
      status === "recording" ? labels.dictation.recording : status === "transcribing" ? labels.dictation.transcribing : null,
    cancel,
    clearError: () => setError(null),
    toggle
  };
}
