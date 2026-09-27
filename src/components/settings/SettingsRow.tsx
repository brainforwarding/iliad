/**
 * One row style for every Settings item (spec 2026-09-25, Figma frame 15;
 * premium pass Figma H/J): name on the left, an optional grey note under it,
 * the control on the right, a hairline under the row. The class names keep the
 * Writing assists prefix they started with.
 */
export function RowCopy({ label, note, noteClassName }: { label: string; note?: string | null; noteClassName?: string }) {
  return (
    <span className="writing-assist-row-copy">
      <span className="writing-assist-row-label">{label}</span>
      {note ? <span className={noteClassName ? `writing-assist-row-note ${noteClassName}` : "writing-assist-row-note"}>{note}</span> : null}
    </span>
  );
}

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/** A small segmented control (pressed buttons in a labelled group). */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange
}: {
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="settings-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? "settings-segment is-active" : "settings-segment"}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
