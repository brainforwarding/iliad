import { ChevronDown, PenLine } from "lucide-react";
import { useEffect, useRef, useState, type Dispatch, type FormEvent, type ReactNode, type RefObject, type SetStateAction } from "react";
import { autocompleteShortcutActions, autocompleteShortcutChoices, compactShortcutLabel, shortcutLabel, type AutocompletePreferences } from "../editor/ideaAutocomplete/options";
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
  onResetShortcuts: () => void;
  menuRef: RefObject<HTMLDivElement>;
  open: boolean;
  correctorEnabled: boolean;
  autocompleteEnabled: boolean;
  correctorAvailable: boolean;
  /** Null while the key state is unknown (nothing about the key is shown). */
  geminiKey: GeminiKeyState | null;
  /** Saves (string) or removes (null) the Gemini key; rejects on failure. */
  onSaveGeminiKey: (key: string | null) => Promise<void>;
  onGetGeminiKey: () => void;
  /** Opens the privacy page (in the app language) in the browser. */
  onOpenPrivacy: () => void;
  /** Bumped to open the key form and focus its field (✦ AI clicked without a key). */
  keyFieldFocusRequest?: number;
  onToggleOpen: () => void;
  onSetCorrectorEnabled: Dispatch<SetStateAction<boolean>>;
  onSetAutocompleteEnabled: Dispatch<SetStateAction<boolean>>;
}

type GeminiKeyLabels = Pick<
  AppStrings["writingAssists"],
  | "geminiKey"
  | "geminiKeyRow"
  | "geminiKeyHint"
  | "geminiKeyPlaceholder"
  | "geminiKeySave"
  | "geminiKeyCancel"
  | "geminiKeyRemove"
  | "geminiKeyGet"
  | "geminiKeySaved"
  | "geminiKeyAdd"
  | "geminiKeyChange"
  | "geminiKeySaveFailed"
>;

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
 * The AI key row: "Gemini key" with the last four characters and a "Change"
 * link, or an "Add key" link without a key. The link opens the key form in
 * place of the row.
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
  const [editing, setEditing] = useState(Boolean(focusRequest) && !keyState.hasKey);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // ✦ AI without a key opens the form with its field focused.
  useEffect(() => {
    if (focusRequest && !keyState.hasKey) {
      setEditing(true);
    }
  }, [focusRequest, keyState.hasKey]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
    }
  }, [editing]);

  const close = () => {
    setEditing(false);
    setDraft("");
    setFailed(false);
  };

  const save = async (key: string | null) => {
    setSaving(true);
    setFailed(false);

    try {
      await onSave(key);
      close();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="writing-assist-row">
        <RowCopy label={labels.geminiKeyRow} note={keyState.hasKey ? labels.geminiKeySaved(keyState.last4 ?? "") : labels.geminiKeyHint} />
        <button type="button" className="writing-assist-link" onClick={() => setEditing(true)}>
          {keyState.hasKey ? labels.geminiKeyChange : labels.geminiKeyAdd}
        </button>
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
      <label className="writing-assist-row-label" htmlFor="writing-assist-gemini-key">
        {labels.geminiKey}
      </label>
      <input
        ref={inputRef}
        id="writing-assist-gemini-key"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        placeholder={labels.geminiKeyPlaceholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            close();
          }
        }}
      />
      {failed ? <span className="writing-assist-key-error" role="alert">{labels.geminiKeySaveFailed}</span> : null}
      <div className="writing-assist-key-actions">
        <button type="submit" className="writing-assist-link" disabled={!draft.trim() || saving}>
          {labels.geminiKeySave}
        </button>
        <button type="button" className="writing-assist-link" onClick={close}>
          {labels.geminiKeyCancel}
        </button>
        {keyState.hasKey ? (
          <button type="button" className="writing-assist-link" disabled={saving} onClick={() => void save(null)}>
            {labels.geminiKeyRemove}
          </button>
        ) : (
          <button type="button" className="writing-assist-link" onClick={onGetKey}>
            {labels.geminiKeyGet}
          </button>
        )}
      </div>
    </form>
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
  geminiKey,
  onSaveGeminiKey,
  onGetGeminiKey,
  onOpenPrivacy,
  keyFieldFocusRequest,
  onToggleOpen,
  onSetCorrectorEnabled,
  onSetAutocompleteEnabled
}: WritingAssistsMenuProps) {
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
              <label className="writing-assist-row" key={action}>
                <RowCopy label={shortcutActionLabels[action]} />
                {/* The chip shows the compact key; the native select sits invisibly on top of it. */}
                <span className="writing-assist-key-select">
                  <span aria-hidden="true">{compactShortcutLabel(preferences.shortcuts[action])}</span>
                  <ChevronDown size={11} aria-hidden="true" />
                  <select value={preferences.shortcuts[action]} aria-label={shortcutActionLabels[action]}
                    onChange={(event) => onPreferencesChange({ ...preferences, shortcuts: { ...preferences.shortcuts, [action]: event.target.value } })}>
                    {autocompleteShortcutChoices.map((key) => <option key={key} value={key}
                      disabled={key !== preferences.shortcuts[action] && Object.values(preferences.shortcuts).includes(key)}>{shortcutLabel(key)}</option>)}
                  </select>
                </span>
              </label>
            ))}
            <KeyTextRow label={labels.accept} keyText="Tab" />
            <KeyTextRow label={labels.alternatives} keyText={`${compactShortcutLabel("Alt")} ↑↓`} />
            <KeyTextRow label={labels.dismiss} keyText="Esc" />
            <button type="button" className="writing-assist-row is-button" onClick={onResetShortcuts}>
              <RowCopy label={labels.reset} />
            </button>
          </> : null}
          {geminiKey ? (
            <GeminiKeyRow keyState={geminiKey} labels={labels} onSave={onSaveGeminiKey} onGetKey={onGetGeminiKey}
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
