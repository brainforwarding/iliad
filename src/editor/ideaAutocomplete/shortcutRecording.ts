import {
  autocompleteShortcutActions,
  canonicalShortcut,
  checkShortcut,
  heldModifiers,
  shortcutFromKeyEvent,
  type AutocompletePreferences,
  type AutocompleteShortcutAction,
  type ShortcutKeyEvent
} from "./options";

/**
 * Recording a shortcut in Writing assists (spec 2026-09-27, Figma frame 16):
 * the chip waits for keys; a key another row uses can be swapped with Enter;
 * keys Iliad already uses, or keys without ⌘/⌃, are refused while recording
 * continues. Esc cancels; Tab is left to move focus (blur cancels).
 */
export interface ShortcutRecording {
  action: AutocompleteShortcutAction;
  /** Modifiers held right now, as a key-name prefix ("Mod-Alt"). */
  held: string;
  problem?:
    | { kind: "conflict"; key: string; other: AutocompleteShortcutAction }
    | { kind: "taken" | "modifier"; key: string };
}

type Shortcuts = AutocompletePreferences["shortcuts"];

export interface RecordingStep {
  /** False when the key must keep its normal meaning (Tab moves focus). */
  handled: boolean;
  recording: ShortcutRecording | null;
  /** New shortcuts to save, when the step changed them. */
  shortcuts?: Shortcuts;
}

export function recordShortcutKeyDown(
  recording: ShortcutRecording,
  event: ShortcutKeyEvent & { repeat?: boolean },
  shortcuts: Shortcuts,
  mac: boolean
): RecordingStep {
  const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
  // Tab and ⇧Tab move focus as usual, which cancels (blur).
  if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) return { handled: false, recording };
  // A held key repeating (e.g. the Enter that started recording) is not a new attempt.
  if (event.repeat) return { handled: true, recording };
  if (event.key === "Escape") return { handled: true, recording: null };
  const { action, problem } = recording;
  if (problem?.kind === "conflict" && event.key === "Enter" && plain) {
    return { handled: true, recording: null, shortcuts: { ...shortcuts, [action]: problem.key, [problem.other]: shortcuts[action] } };
  }
  const key = shortcutFromKeyEvent(event, mac);
  if (!key) return { handled: true, recording: { ...recording, held: heldModifiers(event, mac) } };
  const check = checkShortcut(key);
  if (check !== "ok") {
    return { handled: true, recording: { action, held: "", problem: { kind: check === "taken" ? "taken" : "modifier", key } } };
  }
  const other = autocompleteShortcutActions.find((candidate) =>
    candidate !== action && canonicalShortcut(shortcuts[candidate]) === canonicalShortcut(key));
  if (other) return { handled: true, recording: { action, held: "", problem: { kind: "conflict", key, other } } };
  if (canonicalShortcut(key) === canonicalShortcut(shortcuts[action])) return { handled: true, recording: null };
  return { handled: true, recording: null, shortcuts: { ...shortcuts, [action]: key } };
}
