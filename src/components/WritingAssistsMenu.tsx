import { PenLine, Moon, RotateCcw } from "lucide-react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { autocompleteShortcutActions, autocompleteShortcutChoices, shortcutLabel, type AutocompletePreferences, type WritingGuidance } from "../editor/ideaAutocomplete/options";
import type { AppStrings } from "../i18n/strings";

interface WritingAssistsMenuLabels {
  title: string;
  dialogLabel: string;
  corrector: string;
  autocomplete: string;
  apiFallback: string;
  correctorUnavailable: string;
}

interface WritingAssistsMenuProps {
  labels: WritingAssistsMenuLabels & AppStrings["writingAssists"];
  preferences: AutocompletePreferences;
  onPreferencesChange: (preferences: AutocompletePreferences) => void;
  guidance: WritingGuidance;
  onGuidanceChange: (guidance: WritingGuidance) => void;
  hasDocument: boolean;
  snoozed: boolean;
  onToggleSnooze: () => void;
  onResetShortcuts: () => void;
  menuRef: RefObject<HTMLDivElement>;
  open: boolean;
  correctorEnabled: boolean;
  autocompleteEnabled: boolean;
  autocompleteApiFallbackEnabled: boolean;
  correctorAvailable: boolean;
  autocompleteNote?: string;
  showApiFallback: boolean;
  onToggleOpen: () => void;
  onSetCorrectorEnabled: Dispatch<SetStateAction<boolean>>;
  onSetAutocompleteEnabled: Dispatch<SetStateAction<boolean>>;
  onSetAutocompleteApiFallbackEnabled: Dispatch<SetStateAction<boolean>>;
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
  preferences, onPreferencesChange, guidance, onGuidanceChange, hasDocument, snoozed, onToggleSnooze, onResetShortcuts,
  labels,
  menuRef,
  open,
  correctorEnabled,
  autocompleteEnabled,
  autocompleteApiFallbackEnabled,
  correctorAvailable,
  autocompleteNote,
  showApiFallback,
  onToggleOpen,
  onSetCorrectorEnabled,
  onSetAutocompleteEnabled,
  onSetAutocompleteApiFallbackEnabled
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
            <details className="writing-assist-details">
              <summary>{labels.writingNotes}{guidance.enabled && (guidance.voice || guidance.facts) ? <span className="writing-assist-note-dot" /> : null}</summary>
              <label className="writing-assist-check"><input type="checkbox" checked={guidance.enabled} disabled={!hasDocument}
                onChange={(event) => onGuidanceChange({ ...guidance, enabled: event.target.checked })} />{labels.useNotes}</label>
              <input value={guidance.voice} maxLength={400} disabled={!hasDocument} aria-label={labels.voice} placeholder={labels.voice}
                onChange={(event) => onGuidanceChange({ ...guidance, voice: event.target.value })} />
              <textarea value={guidance.facts} maxLength={4000} rows={4} disabled={!hasDocument} aria-label={labels.facts} placeholder={labels.facts}
                onChange={(event) => onGuidanceChange({ ...guidance, facts: event.target.value })} />
            </details>
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
          {showApiFallback ? (
            <SwitchRow
              label={labels.apiFallback}
              checked={autocompleteApiFallbackEnabled}
              onToggle={() => onSetAutocompleteApiFallbackEnabled((enabled) => !enabled)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
