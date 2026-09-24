import { NotebookPen, PenLine, Moon, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type Dispatch, type FormEvent, type RefObject, type SetStateAction } from "react";
import { autocompleteShortcutActions, autocompleteShortcutChoices, shortcutLabel, type AutocompletePreferences } from "../editor/ideaAutocomplete/options";
import type { AppStrings } from "../i18n/strings";
import type { GeminiKeyState } from "../types/iliad";

export const GEMINI_KEY_URL = "https://aistudio.google.com/apikey";

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
  /** Opens (creating if needed) the open document's `stem.notes.md`. */
  onOpenNotes: () => void;
  /** False when the open file cannot have notes (none open, or it is itself a notes/comments file). */
  notesAvailable: boolean;
  hasNotes: boolean;
  snoozed: boolean;
  onToggleSnooze: () => void;
  onResetShortcuts: () => void;
  menuRef: RefObject<HTMLDivElement>;
  open: boolean;
  correctorEnabled: boolean;
  autocompleteEnabled: boolean;
  correctorAvailable: boolean;
  autocompleteNote?: string;
  /** Null while the key state is unknown (nothing about the key is shown). */
  geminiKey: GeminiKeyState | null;
  /** Saves (string) or removes (null) the Gemini key; rejects on failure. */
  onSaveGeminiKey: (key: string | null) => Promise<void>;
  onGetGeminiKey: () => void;
  /** Bumped to move focus to the key field (✦ AI clicked without a key). */
  keyFieldFocusRequest?: number;
  onToggleOpen: () => void;
  onSetCorrectorEnabled: Dispatch<SetStateAction<boolean>>;
  onSetAutocompleteEnabled: Dispatch<SetStateAction<boolean>>;
}

type GeminiKeyLabels = Pick<
  AppStrings["writingAssists"],
  | "geminiKey"
  | "geminiKeyHint"
  | "geminiKeyPlaceholder"
  | "geminiKeySave"
  | "geminiKeyCancel"
  | "geminiKeyRemove"
  | "geminiKeyGet"
  | "geminiKeySaved"
  | "geminiKeyChange"
  | "geminiKeySaveFailed"
>;

/**
 * The one AI setting. Without a key it is a small form (first row of the
 * menu); with a key it is a quiet line ("Gemini key ••••1234 · Change").
 */
function GeminiKeyRow({
  keyState,
  labels,
  onSave,
  onGetKey,
  focusRequest
}: {
  keyState: GeminiKeyState;
  labels: GeminiKeyLabels;
  onSave: (key: string | null) => Promise<void>;
  onGetKey: () => void;
  focusRequest?: number;
}) {
  const [changing, setChanging] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const editing = !keyState.hasKey || changing;

  useEffect(() => {
    if (focusRequest && editing) {
      inputRef.current?.focus();
    }
  }, [editing, focusRequest]);

  const save = async (key: string | null) => {
    setSaving(true);
    setFailed(false);

    try {
      await onSave(key);
      setDraft("");
      setChanging(false);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="writing-assist-key-summary">
        <span>{labels.geminiKeySaved(keyState.last4 ?? "")}</span>
        <span aria-hidden="true">·</span>
        <button type="button" className="writing-assist-link" onClick={() => setChanging(true)}>
          {labels.geminiKeyChange}
        </button>
      </div>
    );
  }

  return (
    <form
      className="writing-assist-key"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();

        if (draft.trim() && !saving) {
          void save(draft.trim());
        }
      }}
    >
      <label className="writing-assist-key-label" htmlFor="writing-assist-gemini-key">
        {labels.geminiKey}
      </label>
      {!keyState.hasKey ? <span className="writing-assist-switch-note">{labels.geminiKeyHint}</span> : null}
      <input
        ref={inputRef}
        id="writing-assist-gemini-key"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        placeholder={labels.geminiKeyPlaceholder}
        onChange={(event) => setDraft(event.target.value)}
      />
      {failed ? <span className="writing-assist-key-error" role="alert">{labels.geminiKeySaveFailed}</span> : null}
      <div className="writing-assist-key-actions">
        <button type="submit" className="writing-assist-key-save" disabled={!draft.trim() || saving}>
          {labels.geminiKeySave}
        </button>
        {changing ? (
          <>
            <button type="button" className="writing-assist-link" onClick={() => { setChanging(false); setDraft(""); setFailed(false); }}>
              {labels.geminiKeyCancel}
            </button>
            <button type="button" className="writing-assist-link" disabled={saving} onClick={() => void save(null)}>
              {labels.geminiKeyRemove}
            </button>
          </>
        ) : (
          <button type="button" className="writing-assist-link" onClick={onGetKey}>
            {labels.geminiKeyGet}
          </button>
        )}
      </div>
    </form>
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
      className="writing-assist-switch-row"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className="writing-assist-switch-copy">
        <span className="writing-assist-switch-label">{label}</span>
        {note ? <span className="writing-assist-switch-note">{note}</span> : null}
      </span>
      <span className={checked ? "writing-assist-switch is-on" : "writing-assist-switch"} aria-hidden="true">
        <span />
      </span>
    </button>
  );
}

export function WritingAssistsMenu({
  preferences, onPreferencesChange, onOpenNotes, notesAvailable, hasNotes, snoozed, onToggleSnooze, onResetShortcuts,
  labels,
  menuRef,
  open,
  correctorEnabled,
  autocompleteEnabled,
  correctorAvailable,
  autocompleteNote,
  geminiKey,
  onSaveGeminiKey,
  onGetGeminiKey,
  keyFieldFocusRequest,
  onToggleOpen,
  onSetCorrectorEnabled,
  onSetAutocompleteEnabled
}: WritingAssistsMenuProps) {
  const continueKey = shortcutLabel(preferences.shortcuts.continue);
  const shortcutActionLabels = { continue: labels.continueKey, sentence: labels.sentenceKey, paragraph: labels.paragraphKey, idea: labels.ideaKey };
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
          {geminiKey && !geminiKey.hasKey ? (
            <GeminiKeyRow keyState={geminiKey} labels={labels} onSave={onSaveGeminiKey} onGetKey={onGetGeminiKey}
              focusRequest={keyFieldFocusRequest} />
          ) : null}
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
            note={autocompleteNote}
            onToggle={() => onSetAutocompleteEnabled((enabled) => !enabled)}
          />
          {autocompleteEnabled ? <>
            {/* In-the-moment actions live on the suggestion and selection bars; this menu is settings only. */}
            <SwitchRow
              label={labels.suggestWhileTyping}
              checked={!preferences.manualOnly}
              note={preferences.manualOnly ? labels.suggestWhileTypingOff(continueKey) : undefined}
              onToggle={() => onPreferencesChange({ ...preferences, manualOnly: !preferences.manualOnly })}
            />
            <button type="button" className="writing-assist-quiet" onClick={onToggleSnooze}><Moon size={14} />{snoozed ? labels.resume : labels.snooze}</button>
            <button type="button" className="writing-assist-quiet" disabled={!notesAvailable} onClick={onOpenNotes}
              title={labels.openNotesHint}>
              <NotebookPen size={14} />{labels.openNotes}{hasNotes ? <span className="writing-assist-note-dot" /> : null}
            </button>
            <details className="writing-assist-details">
              <summary>{labels.shortcuts}</summary>
              {autocompleteShortcutActions.map((action) => <label className="writing-assist-shortcut-row" key={action}>
                {shortcutActionLabels[action]}<select value={preferences.shortcuts[action]} aria-label={shortcutActionLabels[action]}
                  onChange={(event) => onPreferencesChange({ ...preferences, shortcuts: { ...preferences.shortcuts, [action]: event.target.value } })}>
                  {autocompleteShortcutChoices.map((key) => <option key={key} value={key}
                    disabled={key !== preferences.shortcuts[action] && Object.values(preferences.shortcuts).includes(key)}>{shortcutLabel(key)}</option>)}
                </select>
              </label>)}
              <p className="writing-assist-shortcut-hint">{labels.continueKeyHint}</p>
              <div className="writing-assist-shortcut-row"><span>{labels.accept}</span><kbd>Tab</kbd></div>
              <div className="writing-assist-shortcut-row"><span>{labels.alternatives}</span><kbd>{shortcutLabel("Alt-↑/↓")}</kbd></div>
              <div className="writing-assist-shortcut-row"><span>{labels.dismiss}</span><kbd>Esc</kbd></div>
              <button className="writing-assist-quiet" type="button" onClick={onResetShortcuts}><RotateCcw size={13} />{labels.reset}</button>
              <label className="writing-assist-check"><input type="checkbox" checked={preferences.announce}
                onChange={(event) => onPreferencesChange({ ...preferences, announce: event.target.checked })} />{labels.announce}</label>
            </details>
          </> : null}
          {geminiKey?.hasKey ? (
            <GeminiKeyRow keyState={geminiKey} labels={labels} onSave={onSaveGeminiKey} onGetKey={onGetGeminiKey}
              focusRequest={keyFieldFocusRequest} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
