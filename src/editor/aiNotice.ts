import type { AiRoute, IdeaAutocompleteFailureReason, TightenFailureReason } from "../types/iliad";
import type { AppStrings } from "../i18n/strings";

// Inline AI notices shared by the suggestion bar and the ✦ AI menu (Groq spec
// §8). Calm, never a count. Free-route notices offer "Use my key"; own-key
// problems offer "Update key" and never mention the free route.

export type AiNoticeLabels = AppStrings["editor"]["aiNotices"];
export type AiNoticeAction = "use-key" | "update-key";
export interface AiNotice {
  message: string;
  action: AiNoticeAction | null;
}

type NoticeReason = IdeaAutocompleteFailureReason | TightenFailureReason;

/** The next 00:00 UTC after `now` (the free quota's reset), used when the proxy sent no `resetAt`. */
export function nextUtcMidnight(now: number): Date {
  const date = new Date(now);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
}

/** `resetAt` as a local time in the app language's locale, e.g. "9:00 PM" / "21:00". */
export function formatResetTime(resetAt: string | undefined, language: "en" | "es", now = Date.now(), timeZone?: string): string {
  const parsed = resetAt ? Date.parse(resetAt) : Number.NaN;
  const date = Number.isFinite(parsed) ? new Date(parsed) : nextUtcMidnight(now);
  return new Intl.DateTimeFormat(language, { hour: "numeric", minute: "2-digit", ...(timeZone ? { timeZone } : {}) }).format(date);
}

/** The notice for a failure reason, or null when the reason keeps its existing generic message. */
export function aiNoticeForReason(
  reason: NoticeReason,
  options: { route: AiRoute | null; resetAt?: string; language: "en" | "es"; labels: AiNoticeLabels; now?: number; timeZone?: string }
): AiNotice | null {
  const { labels } = options;
  const ownKey = options.route === "own-key";

  switch (reason) {
    case "free_exhausted":
      return {
        message: labels.freeExhausted(formatResetTime(options.resetAt, options.language, options.now, options.timeZone)),
        action: "use-key"
      };
    case "free_unavailable":
      return { message: labels.freePaused, action: "use-key" };
    case "client_outdated":
      return { message: labels.clientOutdated, action: "use-key" };
    case "unreachable":
      return ownKey ? { message: labels.ownKeyUnreachable, action: null } : { message: labels.freeUnreachable, action: "use-key" };
    case "rate_limited":
      return ownKey ? { message: labels.ownKeyRateLimited, action: null } : { message: labels.freeBusy, action: null };
    case "invalid_api_key":
      return { message: labels.ownKeyRejected, action: "update-key" };
    case "key_unreadable":
      return { message: labels.keyUnreadable, action: "update-key" };
    default:
      return null;
  }
}
