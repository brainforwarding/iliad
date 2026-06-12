import { describe, expect, it, vi } from "vitest";
import { scheduleTranscriptScrollToBottom } from "../../src/assistant/useAssistantRun";

describe("scheduleTranscriptScrollToBottom", () => {
  it("scrolls immediately, repeats on the next animation frame, and cancels cleanup", () => {
    let scheduledCallback: FrameRequestCallback | null = null;
    const transcript = {
      scrollHeight: 120,
      scrollTo: vi.fn()
    };
    const scheduleFrame = vi.fn((callback: FrameRequestCallback) => {
      scheduledCallback = callback;
      return 42;
    });
    const cancelFrame = vi.fn();

    const cleanup = scheduleTranscriptScrollToBottom(transcript, scheduleFrame, cancelFrame);

    expect(transcript.scrollTo).toHaveBeenCalledWith({ top: 120 });
    expect(scheduleFrame).toHaveBeenCalledTimes(1);

    transcript.scrollHeight = 260;
    scheduledCallback?.(performance.now());

    expect(transcript.scrollTo).toHaveBeenLastCalledWith({ top: 260 });

    cleanup?.();

    expect(cancelFrame).toHaveBeenCalledWith(42);
  });

  it("is a no-op when the transcript element is unavailable", () => {
    const scheduleFrame = vi.fn();
    const cleanup = scheduleTranscriptScrollToBottom(null, scheduleFrame, vi.fn());

    expect(cleanup).toBeUndefined();
    expect(scheduleFrame).not.toHaveBeenCalled();
  });
});

