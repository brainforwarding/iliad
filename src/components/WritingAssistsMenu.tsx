import { PenLine } from "lucide-react";
import type { Dispatch, RefObject, SetStateAction } from "react";

interface WritingAssistsMenuLabels {
  title: string;
  dialogLabel: string;
  corrector: string;
  autocomplete: string;
  apiFallback: string;
  correctorUnavailable: string;
}

interface WritingAssistsMenuProps {
  labels: WritingAssistsMenuLabels;
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
