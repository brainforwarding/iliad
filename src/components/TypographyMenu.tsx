import { ALargeSmall } from "lucide-react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  defaultEditorFontPreset,
  defaultEditorFontSize,
  editorFontPresets,
  type EditorFontPreset
} from "../preferences/editorPreferences";

interface TypographyMenuLabels {
  title: string;
  dialogLabel: string;
  decreaseFontSize: string;
  increaseFontSize: string;
  fontPreset: string;
  presets: Record<EditorFontPreset, string>;
  reset: string;
}

interface TypographyMenuProps {
  editorFontPreset: EditorFontPreset;
  editorFontSize: number;
  labels: TypographyMenuLabels;
  menuRef: RefObject<HTMLDivElement>;
  onReset: () => void;
  onSetFontPreset: Dispatch<SetStateAction<EditorFontPreset>>;
  onSetFontSize: Dispatch<SetStateAction<number>>;
  onToggleOpen: () => void;
  open: boolean;
}

export function TypographyMenu({
  editorFontPreset,
  editorFontSize,
  labels,
  menuRef,
  onReset,
  onSetFontPreset,
  onSetFontSize,
  onToggleOpen,
  open
}: TypographyMenuProps) {
  return (
    <div className="typography-menu" ref={menuRef}>
      <button
        type="button"
        className="icon-button"
        data-tooltip={labels.title}
        aria-label={labels.title}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onToggleOpen}
      >
        <ALargeSmall size={17} />
      </button>

      {open ? (
        <div className="typography-popover" role="dialog" aria-label={labels.dialogLabel}>
          <div className="typography-row">
            <button
              type="button"
              className="typography-step-button"
              aria-label={labels.decreaseFontSize}
              onClick={() => onSetFontSize((size) => size - 1)}
            >
              A-
            </button>
            <span className="typography-size-value">{editorFontSize}px</span>
            <button
              type="button"
              className="typography-step-button"
              aria-label={labels.increaseFontSize}
              onClick={() => onSetFontSize((size) => size + 1)}
            >
              A+
            </button>
          </div>

          <div className="font-preset-group" aria-label={labels.fontPreset}>
            {editorFontPresets.map((preset) => (
              <button
                key={preset}
                type="button"
                className={preset === editorFontPreset ? "font-preset-button is-active" : "font-preset-button"}
                aria-pressed={preset === editorFontPreset}
                onClick={() => onSetFontPreset(preset)}
              >
                {labels.presets[preset]}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="typography-reset-button"
            onClick={() => {
              onReset();
              onSetFontSize(defaultEditorFontSize);
              onSetFontPreset(defaultEditorFontPreset);
            }}
          >
            {labels.reset}
          </button>
        </div>
      ) : null}
    </div>
  );
}
