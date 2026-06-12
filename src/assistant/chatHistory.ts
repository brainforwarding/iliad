import type { AgentChatHistoryEntry, AgentChatThreadSummary } from "../types/iliad";

const MAX_TITLE_LENGTH = 72;

export function fallbackChatThreadTitle(text: string) {
  const stripped = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[*_~>#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const title = stripped.slice(0, MAX_TITLE_LENGTH).trim().replace(/[.,;:!?]+$/u, "");
  return title || "Untitled conversation";
}

export function compactChatThreadAge(updatedAt: string, now = new Date()) {
  const updated = new Date(updatedAt);
  const elapsedMs = Math.max(0, now.getTime() - updated.getTime());
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;

  if (elapsedMs < hour) {
    return `${Math.max(1, Math.floor(elapsedMs / minute))}m`;
  }

  if (elapsedMs < day) {
    return `${Math.max(1, Math.floor(elapsedMs / hour))}h`;
  }

  if (elapsedMs < week) {
    return `${Math.max(1, Math.floor(elapsedMs / day))}d`;
  }

  return `${Math.max(1, Math.floor(elapsedMs / week))}w`;
}

export type ChatHistoryGroupKey = "today" | "yesterday" | "thisWeek" | "older";

export function chatHistoryGroup(updatedAt: string, now = new Date()): ChatHistoryGroupKey {
  const updated = new Date(updatedAt);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 24 * 60 * 60 * 1000;

  if (updated.getTime() >= startToday) {
    return "today";
  }

  if (updated.getTime() >= startYesterday) {
    return "yesterday";
  }

  if (now.getTime() - updated.getTime() < 7 * 24 * 60 * 60 * 1000) {
    return "thisWeek";
  }

  return "older";
}

export function visibleHistoryEntries(entries: Array<Partial<AgentChatHistoryEntry> & { contextManifest?: unknown }>) {
  const now = new Date().toISOString();

  return entries
    .filter((entry) => entry.kind === "user" || entry.kind === "assistant" || entry.kind === "error" || entry.kind === "status")
    .filter((entry) => typeof entry.text === "string" && entry.text.trim())
    .map((entry, index) => {
      const source = entry.source === "desktop" || entry.source === "telegram" ? entry.source : undefined;
      return {
        id: typeof entry.id === "string" && entry.id ? entry.id : `entry-${index}`,
        kind: entry.kind as AgentChatHistoryEntry["kind"],
        text: entry.text as string,
        createdAt: typeof entry.createdAt === "string" ? entry.createdAt : now,
        ...(source ? { source } : {})
      };
    });
}

export function upsertChatThreadSummary(
  threads: AgentChatThreadSummary[],
  summary: AgentChatThreadSummary
): AgentChatThreadSummary[] {
  return [summary, ...threads.filter((thread) => thread.id !== summary.id)].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  );
}
