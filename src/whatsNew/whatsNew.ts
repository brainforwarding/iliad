import { whatsNewEntries, type WhatsNewEntry } from "./entries";

/** The last app version this profile launched (a local preference, never written to documents). */
export const whatsNewLastSeenStorageKey = "iliad:last-seen-version";

export const releaseNotesBaseUrl = "https://github.com/brainforwarding/iliad/releases/tag/";

export function releaseNotesUrl(version: string) {
  return `${releaseNotesBaseUrl}v${version}`;
}

function parse(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Negative when `left` is older than `right`; null when either isn't a version. */
export function compareAppVersions(left: string, right: string) {
  const a = parse(left);
  const b = parse(right);

  if (!a || !b) {
    return null;
  }

  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] - b[index];
    }
  }

  return 0;
}

export interface WhatsNewDecisionInput {
  currentVersion: string;
  /** The stored last-seen version, or null (fresh install, or 0.5.0 and older, which stored none). */
  lastSeenVersion: string | null;
  /** Signs of earlier use without a last-seen version: the last-workspace (or recent-workspaces) preference. */
  usedBefore: boolean;
  entries?: readonly WhatsNewEntry[];
}

/**
 * The card to show on this launch, if any. Shown once, on the first launch of
 * a version that has an entry, and only for someone who used Iliad before: a
 * stored last-seen version older than this one or — since 0.5.0 stored none —
 * an existing workspace preference. A fresh install sees nothing.
 */
export function whatsNewToShow({
  currentVersion,
  lastSeenVersion,
  usedBefore,
  entries = whatsNewEntries
}: WhatsNewDecisionInput): WhatsNewEntry | null {
  const entry = entries.find((item) => item.version === currentVersion);

  if (!entry) {
    return null;
  }

  if (lastSeenVersion === null) {
    return usedBefore ? entry : null;
  }

  const delta = compareAppVersions(lastSeenVersion, currentVersion);
  return delta !== null && delta < 0 ? entry : null;
}

export interface WhatsNewStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/**
 * Decides and records in one step, so only the first window of this version
 * shows the card (windows share localStorage). The last-seen version never
 * moves backwards (running an older build doesn't re-arm a newer card).
 */
export function takeWhatsNew({
  currentVersion,
  storage,
  usedBefore,
  entries
}: {
  currentVersion: string;
  storage: WhatsNewStorage;
  usedBefore: () => boolean;
  entries?: readonly WhatsNewEntry[];
}): WhatsNewEntry | null {
  let lastSeenVersion: string | null = null;

  try {
    lastSeenVersion = storage.getItem(whatsNewLastSeenStorageKey);
  } catch {
    return null;
  }

  const entry = whatsNewToShow({
    currentVersion,
    lastSeenVersion,
    usedBefore: lastSeenVersion === null ? usedBefore() : true,
    entries
  });
  const delta = lastSeenVersion === null ? -1 : compareAppVersions(lastSeenVersion, currentVersion);

  if (delta === null || delta < 0) {
    try {
      storage.setItem(whatsNewLastSeenStorageKey, currentVersion);
    } catch {
      // Storage full or unavailable: the card may show again; never crash launch.
    }
  }

  return entry;
}
