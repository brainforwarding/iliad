import { describe, expect, it } from "vitest";
import {
  chooseDictationMimeType,
  composePromptWithTranscript,
  localRecordingCapErrorMessage
} from "../../src/assistant/useDictation";
import { appStrings } from "../../src/i18n/strings";

describe("chooseDictationMimeType", () => {
  it("prefers webm opus when supported", () => {
    const recorder = {
      isTypeSupported: (mimeType: string) => mimeType === "audio/webm;codecs=opus" || mimeType === "audio/webm"
    };

    expect(chooseDictationMimeType(recorder)).toBe("audio/webm;codecs=opus");
  });

  it("falls back through the allowlist", () => {
    const recorder = {
      isTypeSupported: (mimeType: string) => mimeType === "audio/ogg;codecs=opus"
    };

    expect(chooseDictationMimeType(recorder)).toBe("audio/ogg;codecs=opus");
  });

  it("returns null when no allowed type is supported", () => {
    const recorder = {
      isTypeSupported: () => false
    };

    expect(chooseDictationMimeType(recorder)).toBeNull();
  });
});

describe("composePromptWithTranscript", () => {
  it("sets an empty prompt to the transcript", () => {
    expect(composePromptWithTranscript("", null, "  Draft intro  ")).toEqual({
      value: "Draft intro",
      caret: 11
    });
  });

  it("inserts at the captured selection when the prompt is unchanged", () => {
    expect(
      composePromptWithTranscript("Ask agent", { value: "Ask agent", start: 3, end: 3 }, "the")
    ).toEqual({
      value: "Ask the agent",
      caret: 7
    });
  });

  it("does not add a space before trailing punctuation", () => {
    expect(
      composePromptWithTranscript("Ask.", { value: "Ask.", start: 3, end: 3 }, "again")
    ).toEqual({
      value: "Ask again.",
      caret: 9
    });
  });

  it("appends when the user edited the prompt during transcription", () => {
    expect(
      composePromptWithTranscript("User typed more", { value: "Original", start: 8, end: 8 }, "dictated text")
    ).toEqual({
      value: "User typed more dictated text",
      caret: 29
    });
  });
});

describe("localRecordingCapErrorMessage", () => {
  it("uses the localized recording-too-long message for local recorder caps", () => {
    expect(localRecordingCapErrorMessage(appStrings.en.assistant.dictation)).toBe("Recording too long");
    expect(localRecordingCapErrorMessage(appStrings.es.assistant.dictation)).toBe("La grabación es demasiado larga");
  });
});
