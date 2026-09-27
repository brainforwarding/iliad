import type { Dispatch, SetStateAction } from "react";
import type { AppStrings } from "../../i18n/strings";
import {
  defaultEditorFontPreset,
  defaultEditorFontSize,
  editorFontPresets,
  maximumEditorFontSize,
  minimumEditorFontSize,
  type EditorFontPreset
} from "../../preferences/editorPreferences";
import { RowCopy, Segmented } from "./SettingsRow";

interface TypographySettingsProps {
  editorFontPreset: EditorFontPreset;
  editorFontSize: number;
  labels: AppStrings["typography"] & Pick<AppStrings["settings"], "font" | "size" | "sizeValue">;
  onReset: () => void;
  onSetFontPreset: Dispatch<SetStateAction<EditorFontPreset>>;
  onSetFontSize: Dispatch<SetStateAction<number>>;
}

/** The Typography tab of Settings: Font, Size (A− N px A+, 14–24) and Reset, one row each. */
export function TypographySettings({
  editorFontPreset,
  editorFontSize,
  labels,
  onReset,
  onSetFontPreset,
  onSetFontSize
}: TypographySettingsProps) {
  return (
    <div className="settings-rows">
      <div className="writing-assist-row">
        <RowCopy label={labels.font} />
        <Segmented
          label={labels.fontPreset}
          options={editorFontPresets.map((preset) => ({ value: preset, label: labels.presets[preset] }))}
          value={editorFontPreset}
          onChange={onSetFontPreset}
        />
      </div>
      <div className="writing-assist-row">
        <RowCopy label={labels.size} />
        <span className="settings-stepper">
          <button
            type="button"
            className="settings-step-button"
            aria-label={labels.decreaseFontSize}
            disabled={editorFontSize <= minimumEditorFontSize}
            onClick={() => onSetFontSize((size) => size - 1)}
          >
            A−
          </button>
          <span className="settings-step-value">{labels.sizeValue(editorFontSize)}</span>
          <button
            type="button"
            className="settings-step-button"
            aria-label={labels.increaseFontSize}
            disabled={editorFontSize >= maximumEditorFontSize}
            onClick={() => onSetFontSize((size) => size + 1)}
          >
            A+
          </button>
        </span>
      </div>
      <button
        type="button"
        className="writing-assist-row is-button"
        onClick={() => {
          onReset();
          onSetFontSize(defaultEditorFontSize);
          onSetFontPreset(defaultEditorFontPreset);
        }}
      >
        <RowCopy label={labels.reset} />
      </button>
    </div>
  );
}
