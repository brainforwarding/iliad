import {
  TELEGRAM_CHUNK_MAX_LENGTH,
  type RemoteAnswerSource,
  type RemoteResponse,
  type TelegramMessage,
  type TelegramUpdate
} from "./protocol.js";

export const TELEGRAM_MESSAGES = {
  groupRejected: "Telegram Remote Chat only works in a private chat.",
  tokenExpired: "That pairing link expired. Create a new one in Iliad.",
  offline: "Iliad is offline. Open Iliad on your computer and try again.",
  busy: "Iliad is already answering a remote request. Try again shortly.",
  timeout: "Iliad took too long to answer. Try again.",
  rateLimited: "Too many requests. Try again shortly.",
  unpaired: "This Telegram chat is not paired with Iliad. Pair it from Iliad first.",
  unlinked: "Telegram Remote Chat is unlinked from Iliad.",
  paired: "Paired with Iliad. Send /status or ask a question.",
  askUsage: "Send /ask followed by a question, or send a plain text question.",
  help:
    "Iliad Telegram Remote Chat\n\n/start <code> pairs this chat.\n/status checks the desktop.\n/ask <question> asks about the active workspace.\n/unlink removes this chat."
} as const;

export type TelegramAction =
  | { type: "pair"; token: string }
  | { type: "status" }
  | { type: "ask"; text: string }
  | { type: "help" }
  | { type: "unlink" };

export interface TelegramSender {
  sendMessage(chatId: string, text: string): Promise<void>;
}

export function updateMessage(update: TelegramUpdate): TelegramMessage | null {
  return update.message ?? null;
}

export function dedupeKeyForUpdate(update: TelegramUpdate): string | null {
  const message = updateMessage(update);

  if (typeof update.update_id !== "number" || !message) {
    return null;
  }

  return `telegram:${update.update_id}:message:${message.message_id ?? "none"}`;
}

export function isPrivateMessage(message: TelegramMessage): boolean {
  return message.chat.type === "private";
}

export function chatIdForMessage(message: TelegramMessage): string {
  return String(message.chat.id);
}

export function chatMetadataForMessage(message: TelegramMessage, pairedAt: string) {
  const username = message.from?.username ?? message.chat.username;
  const displayName = displayNameForMessage(message);

  return {
    chatId: chatIdForMessage(message),
    ...(username ? { username } : {}),
    ...(displayName ? { displayName } : {}),
    pairedAt
  };
}

export function parseTelegramAction(message: TelegramMessage): TelegramAction {
  const text = message.text?.trim() ?? "";

  if (!text) {
    return { type: "help" };
  }

  if (!text.startsWith("/")) {
    return { type: "ask", text };
  }

  const [rawCommand = "", ...restParts] = text.split(/\s+/u);
  const command = rawCommand.slice(1).split("@")[0]?.toLowerCase();
  const rest = text.slice(rawCommand.length).trim();

  switch (command) {
    case "start":
      return rest ? { type: "pair", token: rest } : { type: "help" };
    case "status":
      return { type: "status" };
    case "ask":
      return { type: "ask", text: rest };
    case "help":
      return { type: "help" };
    case "unlink":
      return { type: "unlink" };
    default:
      return restParts.length > 0 ? { type: "ask", text: text } : { type: "help" };
  }
}

export function formatRemoteResponse(response: RemoteResponse): string[] {
  if (!response.ok) {
    return chunkTelegramText(response.error.message);
  }

  if (response.type === "status") {
    const workspace = response.workspaceLabel.trim() || "the active workspace";
    return chunkTelegramText(`Iliad is online for ${workspace}. Telegram Remote Chat is enabled.`);
  }

  const answer = response.text.trim() || "Iliad returned an empty answer.";
  const sources = formatSources(response.sources);
  return chunkTelegramText(sources ? `${answer}\n\nSources:\n${sources}` : answer);
}

export function chunkTelegramText(text: string, maxLength = TELEGRAM_CHUNK_MAX_LENGTH): string[] {
  const normalized = text.trim() || " ";

  if (normalized.length <= maxLength) {
    return [normalized];
  }

  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > maxLength) {
    const splitAt = bestSplitIndex(remaining, maxLength);
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function bestSplitIndex(text: string, maxLength: number): number {
  const window = text.slice(0, maxLength + 1);
  const paragraphBreak = window.lastIndexOf("\n\n");

  if (paragraphBreak > maxLength * 0.55) {
    return paragraphBreak;
  }

  const lineBreak = window.lastIndexOf("\n");

  if (lineBreak > maxLength * 0.55) {
    return lineBreak;
  }

  const space = window.lastIndexOf(" ");
  return space > maxLength * 0.55 ? space : maxLength;
}

function formatSources(sources: RemoteAnswerSource[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const source of sources) {
    const path = source.relativePath.trim();

    if (!path) {
      continue;
    }

    const label = source.line ? `${path}:${source.line}` : path;

    if (seen.has(label)) {
      continue;
    }

    seen.add(label);
    lines.push(`- ${label}`);

    if (lines.length >= 10) {
      break;
    }
  }

  return lines.join("\n");
}

function displayNameForMessage(message: TelegramMessage): string | undefined {
  const firstName = message.from?.first_name ?? message.chat.first_name;
  const lastName = message.from?.last_name ?? message.chat.last_name;
  const joined = [firstName, lastName].filter(Boolean).join(" ").trim();
  return joined || message.chat.title || undefined;
}
