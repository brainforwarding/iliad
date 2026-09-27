import { PenLine } from "lucide-react";
import { useEffect, useRef, useState, type Dispatch, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject, type SetStateAction } from "react";
import {
  autocompleteShortcutActions,
  compactShortcutLabel,
  heldModifiers,
  type AutocompletePreferences,
  type AutocompleteShortcutAction
} from "../editor/ideaAutocomplete/options";
import { recordShortcutKeyDown, type ShortcutRecording } from "../editor/ideaAutocomplete/shortcutRecording";
import type { AppStrings } from "../i18n/strings";
import type { GroqKeyState, SetGroqKeyResult } from "../types/iliad";

export const GROQ_KEY_URL = "https://console.groq.com/keys";

interface WritingAssistsMenuLabels {
  title: string;
  dialogLabel: string;
  corrector: string;
  autocomplete: string;
  correctorUnavailable: string;
}

interface WritingAssistsMenuProps {
  labels: WritingAssistsMenuLabels & AppStrings["writingAssists"];
  preferences: AutocompletePreferences;
  onPreferencesChange: (preferences: AutocompletePreferences) => void;
  onResetShortcuts: () => void;
  menuRef: RefObject<HTMLDivElement>;
  open: boolean;
  correctorEnabled: boolean;
  autocompleteEnabled: boolean;
  correctorAvailable: boolean;
  /** Null while the key state is unknown (nothing about the key is shown). */
  groqKey: GroqKeyState | null;
  /** Saves (string, validated against Groq in main) or removes (null) the key; rejects on an unexpected failure. */
  onSaveGroqKey: (key: string | null) => Promise<SetGroqKeyResult>;
  onGetGroqKey: () => void;
  /** Opens the privacy page (in the app language) in the browser. */
  onOpenPrivacy: () => void;
  /** True while a key chip records keys (the app menu's shortcuts pause meanwhile). */
  onRecordingShortcutChange?: (recording: boolean) => void;
  /** Bumped to open the key form and focus its field (a notice's "Use my key" / "Update key"). */
  keyFieldFocusRequest?: number;
  onToggleOpen: () => void;
  onSetCorrectorEnabled: Dispatch<SetStateAction<boolean>>;
  onSetAutocompleteEnabled: Dispatch<SetStateAction<boolean>>;
}

type GroqKeyLabels = Pick<
  AppStrings["writingAssists"],
  | "aiIncluded"
  | "aiIncludedNote"
  | "useMyKey"
  | "groqKeyRow"
  | "groqKey"
  | "groqKeyPlaceholder"
  | "groqKeyHint"
  | "keySave"
  | "keyCancel"
  | "keyRemove"
  | "keyGet"
  | "keyChange"
  | "keySaved"
  | "keyChecking"
  | "keyRejected"
  | "keyUnreachable"
  | "keyInvalidShape"
  | "keySaveFailed"
  | "keyUnreadableNote"
  | "keyRejectedNote"
>;

type KeyFormError = "rejected" | "unreachable" | "invalid_shape" | "failed";

/**
 * One row style for every item (spec 2026-09-25, Figma frame 15): name on the
 * left, an optional grey note under it, the control on the right, a hairline
 * under the row.
 */
function RowCopy({ label, note }: { label: string; note?: string }) {
  return (
    <span className="writing-assist-row-copy">
      <span className="writing-assist-row-label">{label}</span>
      {note ? <span className="writing-assist-row-note">{note}</span> : null}
    </span>
  );
}

function SwitchRow({
  checked,
  disabled,
  label,
  note,
  onToggle
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  note?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="writing-assist-row is-button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onToggle}
    >
      <RowCopy label={label} note={note} />
      <span className={checked ? "writing-assist-switch is-on" : "writing-assist-switch"} aria-hidden="true">
        <span />
      </span>
    </button>
  );
}

function KeyTextRow({ label, keyText }: { label: string; keyText: ReactNode }) {
  return (
    <div className="writing-assist-row">
      <RowCopy label={label} />
      <kbd className="writing-assist-key-text">{keyText}</kbd>
    </div>
  );
}

/**
 * The AI key row (Groq spec §8, one row style): "AI included — Free, with a
 * daily limit — Use my key" on the free route; "Groq key — ••••1234 — Change ·
 * Remove" with the writer's key; "Re-enter your key" when the saved key can't
 * be read; the note turns into "Groq rejected this key" after Groq refuses it.
 * "Use my key" / "Change" opens the key form in place of the row.
 */
function GroqKeyRow({
  keyState,
  labels,
  onSave,
  onGetKey,
  focusRequest
}: {
  keyState: GroqKeyState;
  labels: GroqKeyLabels;
  onSave: (key: string | null) => Promise<SetGroqKeyResult>;
  onGetKey: () => void;
  focusRequest?: number;
}) {
  const [editing, setEditing] = useState(Boolean(focusRequest));
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState<"key" | "remove" | null>(null);
  const [error, setError] = useState<KeyFormError | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hasSavedKey = keyState.state !== "none";

  // A notice's "Use my key" / "Update key" opens the form with its field focused.
  useEffect(() => {
    if (focusRequest) {
      setEditing(true);
    }
  }, [focusRequest]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
    }
  }, [editing]);

  const close = () => {
    setEditing(false);
    setDraft("");
    setError(null);
  };

  const save = async (key: string | null) => {
    setSaving(key === null ? "remove" : "key");
    setError(null);

    try {
      const result = await onSave(key);

      if (result.ok) {
        close();
      } else {
        setError(result.reason);
      }
    } catch {
      setError("failed");
    } finally {
      setSaving(null);
    }
  };

  const errorText = error === "rejected"
    ? labels.keyRejected
    : error === "unreachable"
      ? labels.keyUnreachable
      : error === "invalid_shape"
        ? labels.keyInvalidShape
        : error === "failed"
          ? labels.keySaveFailed
          : null;

  if (!editing) {
    if (keyState.state === "none") {
      return (
        <div className="writing-assist-row">
          <RowCopy label={labels.aiIncluded} note={labels.aiIncludedNote} />
          <button type="button" className="writing-assist-link" onClick={() => setEditing(true)}>
            {labels.useMyKey}
          </button>
        </div>
      );
    }

    const problem = keyState.state === "unreadable" ? labels.keyUnreadableNote : keyState.rejected ? labels.keyRejectedNote : null;
    return (
      <div className="writing-assist-row">
        <span className="writing-assist-row-copy">
          <span className="writing-assist-row-label">{labels.groqKeyRow}</span>
          <span className={problem ? "writing-assist-row-note is-error" : "writing-assist-row-note"}>
            {keyState.state === "ok" && keyState.last4 ? labels.keySaved(keyState.last4) : null}
            {keyState.state === "ok" && keyState.last4 && problem ? " · " : null}
            {problem}
          </span>
        </span>
        <span className="writing-assist-links">
          <button type="button" className="writing-assist-link" onClick={() => setEditing(true)}>
            {labels.keyChange}
          </button>
          <button type="button" className="writing-assist-link" disabled={saving !== null} onClick={() => void save(null)}>
            {labels.keyRemove}
          </button>
        </span>
      </div>
    );
  }

  return (
    <form
      className="writing-assist-row writing-assist-key"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();

        if (draft.trim() && !saving) {
          void save(draft.trim());
        }
      }}
    >
      <label className="writing-assist-row-label" htmlFor="writing-assist-groq-key">
        {labels.groqKey}
      </label>
      <input
        ref={inputRef}
        id="writing-assist-groq-key"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        placeholder={labels.groqKeyPlaceholder}
        aria-invalid={error ? true : undefined}
        className={error ? "is-error" : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            close();
          }
        }}
      />
      {errorText ? (
        <span className="writing-assist-key-error" role="alert">{errorText}</span>
      ) : (
        <span className="writing-assist-row-note writing-assist-key-hint">{labels.groqKeyHint}</span>
      )}
      <div className="writing-assist-key-actions">
        <button type="submit" className="writing-assist-link" disabled={!draft.trim() || saving !== null}>
          {saving === "key" ? labels.keyChecking : labels.keySave}
        </button>
        <button type="button" className="writing-assist-link" onClick={close}>
          {labels.keyCancel}
        </button>
        {hasSavedKey ? (
          <button type="button" className="writing-assist-link" disabled={saving !== null} onClick={() => void save(null)}>
            {labels.keyRemove}
          </button>
        ) : null}
        <button type="button" className="writing-assist-link" onClick={onGetKey}>
          {labels.keyGet}
        </button>
      </div>
    </form>
  );
}

function ShortcutRow({
  action,
  preferences,
  labels,
  rowLabels,
  recording,
  onRecordingChange,
  onPreferencesChange
}: {
  action: AutocompleteShortcutAction;
  preferences: AutocompletePreferences;
  labels: AppStrings["writingAssists"];
  rowLabels: Record<AutocompleteShortcutAction, string>;
  recording: ShortcutRecording | null;
  onRecordingChange: (recording: ShortcutRecording | null) => void;
  onPreferencesChange: (preferences: AutocompletePreferences) => void;
}) {
  const mac = /Mac/.test(globalThis.navigator?.platform ?? "");
  const current = preferences.shortcuts[action];
  const active = recording?.action === action ? recording : null;
  const clash = recording?.problem?.kind === "conflict" && recording.problem.other === action;
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!active) return;
    const step = recordShortcutKeyDown(active, event.nativeEvent, preferences.shortcuts, mac);
    if (!step.handled) return;
    // Nothing reaches the editor, the menu or the app while recording.
    event.preventDefault();
    event.stopPropagation();
    if (step.shortcuts) onPreferencesChange({ ...preferences, shortcuts: step.shortcuts });
    onRecordingChange(step.recording);
  };

  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (active && !active.problem) onRecordingChange({ ...active, held: heldModifiers(event.nativeEvent, mac) });
  };

  const problem = active?.problem;
  const chipText = problem
    ? compactShortcutLabel(problem.key, mac)
    : active
      ? active.held ? compactShortcutLabel(`${active.held}-…`, mac) : labels.shortcutPress
      : compactShortcutLabel(current, mac);
  const note = !problem
    ? undefined
    : problem.kind === "conflict"
      ? labels.shortcutConflict(rowLabels[problem.other], compactShortcutLabel(problem.key, mac))
      : problem.kind === "taken"
        ? labels.shortcutTaken(compactShortcutLabel(problem.key, mac))
        : labels.shortcutNeedsModifier(mac);
  const chipClass = ["writing-assist-key-button", active ? "is-recording" : "", problem || clash ? "is-warning" : ""]
    .filter(Boolean).join(" ");

  return (
    <div className="writing-assist-row">
      <span className="writing-assist-row-copy">
        <span className="writing-assist-row-label">{rowLabels[action]}</span>
        <span className="writing-assist-row-note is-warning" aria-live="polite" hidden={!note}>{note}</span>
      </span>
      <button type="button" className={chipClass}
        aria-label={active ? labels.shortcutRecording(rowLabels[action]) : labels.shortcutChange(rowLabels[action], compactShortcutLabel(current, mac))}
        onClick={() => { if (!active) onRecordingChange({ action, held: "" }); }}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={() => { if (active) onRecordingChange(null); }}>
        {chipText}
      </button>
    </div>
  );
}

export function WritingAssistsMenu({
  preferences,
  onPreferencesChange,
  onResetShortcuts,
  labels,
  menuRef,
  open,
  correctorEnabled,
  autocompleteEnabled,
  correctorAvailable,
  groqKey,
  onSaveGroqKey,
  onGetGroqKey,
  onOpenPrivacy,
  onRecordingShortcutChange,
  keyFieldFocusRequest,
  onToggleOpen,
  onSetCorrectorEnabled,
  onSetAutocompleteEnabled
}: WritingAssistsMenuProps) {
  const shortcutActionLabels = { continue: labels.continueKey, sentence: labels.sentenceKey, paragraph: labels.paragraphKey, idea: labels.ideaKey };
  const [recording, setRecording] = useState<ShortcutRecording | null>(null);
  // Closing the popover (or turning autocomplete off) ends any recording.
  useEffect(() => {
    if (!open || !autocompleteEnabled) setRecording(null);
  }, [open, autocompleteEnabled]);
  const isRecording = recording !== null;
  const recordingChange = useRef(onRecordingShortcutChange);
  recordingChange.current = onRecordingShortcutChange;
  useEffect(() => {
    if (!isRecording) return;
    recordingChange.current?.(true);
    return () => recordingChange.current?.(false);
  }, [isRecording]);
  return (
    <div className="writing-assists-menu" ref={menuRef}>
      <button
        type="button"
        className="icon-button"
        data-tooltip={labels.title}
        aria-label={labels.title}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onToggleOpen}
      >
        <PenLine size={16} />
      </button>

      {open ? (
        <div className="writing-assists-popover" role="dialog" aria-label={labels.dialogLabel}>
          <SwitchRow
            label={labels.corrector}
            checked={correctorAvailable && correctorEnabled}
            disabled={!correctorAvailable}
            note={correctorAvailable ? undefined : labels.correctorUnavailable}
            onToggle={() => onSetCorrectorEnabled((enabled) => !enabled)}
          />
          <SwitchRow
            label={labels.autocomplete}
            checked={autocompleteEnabled}
            onToggle={() => onSetAutocompleteEnabled((enabled) => !enabled)}
          />
          {autocompleteEnabled ? <>
            {autocompleteShortcutActions.map((action) => (
              <ShortcutRow key={action} action={action} preferences={preferences} labels={labels}
                rowLabels={shortcutActionLabels} recording={recording} onRecordingChange={setRecording}
                onPreferencesChange={onPreferencesChange} />
            ))}
            <KeyTextRow label={labels.accept} keyText="Tab" />
            <KeyTextRow label={labels.alternatives} keyText={`${compactShortcutLabel("Alt")} ↑↓`} />
            <KeyTextRow label={labels.dismiss} keyText="Esc" />
            <button type="button" className="writing-assist-row is-button" onClick={onResetShortcuts}>
              <RowCopy label={labels.reset} />
            </button>
          </> : null}
          {groqKey ? (
            <GroqKeyRow keyState={groqKey} labels={labels} onSave={onSaveGroqKey} onGetKey={onGetGroqKey}
              focusRequest={keyFieldFocusRequest} />
          ) : null}
          <button type="button" className="writing-assist-row is-button" onClick={onOpenPrivacy}>
            <RowCopy label={labels.privacy} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
