import type { AgentActivityRunEvent, AgentRunContextManifest } from "../types/iliad";

export type AssistantEntry = {
  id: string;
  kind: "user" | "assistant" | "error" | "status";
  text: string;
  createdAt?: string;
  source?: "desktop" | "telegram";
  contextManifest?: AgentRunContextManifest;
  /**
   * Ephemeral, in-session run activities (reads/searches/lists) attached to the
   * turn's outcome entry so the receipt survives the run. NOT part of the
   * stored AgentChatHistoryEntry schema; restored threads degrade gracefully.
   */
  activities?: AgentActivityRunEvent[];
  /**
   * Ephemeral markers for files the user manually attached to this message.
   * NOT part of the stored schema.
   */
  attachments?: Array<{ relativePath: string; label: string }>;
  /**
   * Ephemeral, in-session rendering summary for batched selection comments.
   * `text` always holds the full composed message (typed text + block), so
   * persisted chat history and follow-up turns are unchanged; this field is
   * NOT part of the stored AgentChatHistoryEntry schema.
   */
  selectionComments?: { count: number; block: string; typedText: string };
};

export interface RunOutcomeEntryInput {
  runId: string;
  kind: "assistant" | "error";
  text: string;
  createdAt: string;
  contextManifest?: AgentRunContextManifest;
  activities: AgentActivityRunEvent[];
}

/**
 * Builds the turn's outcome entry from the run result and the activities
 * snapshot. Pure on purpose: the attach-or-omit decisions (activities only when
 * non-empty, manifest also on error entries when the failed run produced one)
 * are receipt semantics, not wiring.
 */
export function buildRunOutcomeEntry({
  runId,
  kind,
  text,
  createdAt,
  contextManifest,
  activities
}: RunOutcomeEntryInput): AssistantEntry {
  return {
    id: `${runId}-${kind}`,
    kind,
    text,
    createdAt,
    ...(contextManifest ? { contextManifest } : {}),
    ...(activities.length > 0
      ? { activities: [...activities].sort((left, right) => left.sequence - right.sequence) }
      : {})
  };
}
