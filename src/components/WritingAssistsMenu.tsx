import { PenLine, Moon, RotateCcw } from "lucide-react";
import { useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { autocompleteShortcutChoices, shortcutLabel, type AutocompletePreferences, type WritingGuidance } from "../editor/ideaAutocomplete/options";
import type { AutocompleteAction } from "../editor/ideaAutocomplete/extension";
import type { AppStrings } from "../i18n/strings";

interface WritingAssistsMenuLabels {
  title: string;
  dialogLabel: string;
  corrector: string;
  autocomplete: string;
  apiFallback: string;
  correctorUnavailable: string;
  autocompleteShortcuts: string;
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
  onAutocompleteAction: (action: AutocompleteAction) => void;
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
  preferences, onPreferencesChange, guidance, onGuidanceChange, hasDocument, snoozed, onToggleSnooze, onResetShortcuts, onAutocompleteAction,
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
  const [direction, setDirection] = useState("");
  const lengthLabels = { inline: labels.phrase, sentence: labels.sentence, paragraph: labels.paragraph };
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
            <div className="writing-assist-mode" aria-label={labels.timing}>
              <button type="button" aria-pressed={!preferences.manualOnly} onClick={() => onPreferencesChange({ ...preferences, manualOnly: false })}>{labels.automatic}</button>
              <button type="button" aria-pressed={preferences.manualOnly} onClick={() => onPreferencesChange({ ...preferences, manualOnly: true })}>{labels.onDemand}</button>
            </div>
            <div className="writing-assist-lengths">
              {(["inline", "sentence", "paragraph"] as const).map((kind) => <button key={kind} type="button" disabled={!hasDocument}
                title={shortcutLabel(preferences.shortcuts[kind])} onMouseDown={(event) => event.preventDefault()}
                onClick={() => onAutocompleteAction({ kind })}>{lengthLabels[kind]}</button>)}
            </div>
            <div className="writing-assist-directions">
              {(["example", "transition", "tension"] as const).map((intent) => <button key={intent} type="button" disabled={!hasDocument}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onAutocompleteAction({ kind: "paragraph", direction: labels.directions[intent] })}>{labels[intent]}</button>)}
            </div>
            <form className="writing-assist-direction-input" onSubmit={(event) => {
              event.preventDefault();
              if (direction.trim()) { onAutocompleteAction({ kind: "paragraph", direction: direction.trim() }); setDirection(""); }
            }}>
              <input value={direction} maxLength={240} disabled={!hasDocument} aria-label={labels.direction} placeholder={labels.direction}
                onChange={(event) => setDirection(event.target.value)} />
              <button type="submit" disabled={!hasDocument || !direction.trim()} aria-label={labels.suggest}>↵</button>
            </form>
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
              {(["inline", "sentence", "paragraph"] as const).map((kind) => <label className="writing-assist-shortcut-row" key={kind}>
                {lengthLabels[kind]}<select value={preferences.shortcuts[kind]} aria-label={lengthLabels[kind]}
                  onChange={(event) => onPreferencesChange({ ...preferences, shortcuts: { ...preferences.shortcuts, [kind]: event.target.value } })}>
                  {autocompleteShortcutChoices.map((key) => <option key={key} value={key}
                    disabled={key !== preferences.shortcuts[kind] && Object.values(preferences.shortcuts).includes(key)}>{shortcutLabel(key)}</option>)}
                </select>
              </label>)}
              <div className="writing-assist-shortcut-row"><span>{labels.accept}</span><kbd>Tab</kbd></div>
              <div className="writing-assist-shortcut-row"><span>{labels.word}</span><kbd>{shortcutLabel("Alt-→")}</kbd></div>
              <div className="writing-assist-shortcut-row"><span>{labels.alternatives}</span><kbd>{shortcutLabel("Alt-↑/↓")}</kbd></div>
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
