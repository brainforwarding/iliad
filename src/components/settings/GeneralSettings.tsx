import type { AppLanguage } from "../../i18n/appLanguage";
import type { AppStrings } from "../../i18n/strings";
import type { UpdateCheckResult } from "../../types/iliad";
import { RowCopy, Segmented } from "./SettingsRow";

type GeneralSettingsLabels = Pick<
  AppStrings["settings"],
  | "appLanguage"
  | "version"
  | "versionValue"
  | "updates"
  | "upToDate"
  | "checking"
  | "checkFailed"
  | "ready"
  | "checkNow"
  | "download"
  | "whatsNew"
> & { english: string; spanish: string };

interface GeneralSettingsProps {
  labels: GeneralSettingsLabels;
  language: AppLanguage;
  onSetLanguage: (language: AppLanguage) => void;
  /** The running app's version (package version, the same one main reports). */
  version: string;
  updateStatus: UpdateCheckResult | null;
  updateChecking: boolean;
  onCheckForUpdates: () => void | Promise<void>;
  onDownloadUpdate: () => void | Promise<void>;
  onViewUpdateRelease: () => void | Promise<void>;
}

/** What the Updates row says: nothing before a check, then checking / up to date / failed / ready. */
export function updateRowNote(
  status: UpdateCheckResult | null,
  checking: boolean,
  labels: Pick<GeneralSettingsLabels, "upToDate" | "checking" | "checkFailed" | "ready">
): { text: string; tone: "plain" | "error" | "ready" } | null {
  if (checking) {
    return { text: labels.checking, tone: "plain" };
  }

  if (!status) {
    return null;
  }

  if (status.status === "available") {
    return { text: labels.ready(status.latestVersion), tone: "ready" };
  }

  if (status.status === "current") {
    return { text: labels.upToDate, tone: "plain" };
  }

  return { text: labels.checkFailed, tone: "error" };
}

/**
 * The General tab of Settings (Figma J): App language, Version, and the
 * update check and status that used to live in the workspace menu.
 */
export function GeneralSettings({
  labels,
  language,
  onSetLanguage,
  version,
  updateStatus,
  updateChecking,
  onCheckForUpdates,
  onDownloadUpdate,
  onViewUpdateRelease
}: GeneralSettingsProps) {
  const note = updateRowNote(updateStatus, updateChecking, labels);
  const available = !updateChecking && updateStatus?.status === "available" ? updateStatus : null;

  return (
    <div className="settings-rows">
      <div className="writing-assist-row">
        <RowCopy label={labels.appLanguage} />
        <Segmented
          label={labels.appLanguage}
          options={[
            { value: "en", label: labels.english },
            { value: "es", label: labels.spanish }
          ]}
          value={language}
          onChange={onSetLanguage}
        />
      </div>
      <div className="writing-assist-row">
        <RowCopy label={labels.version} />
        <span className="writing-assist-key-text settings-version">{labels.versionValue(version)}</span>
      </div>
      <div className="writing-assist-row settings-updates-row">
        <span className="writing-assist-row-copy">
          <span className="writing-assist-row-label">{labels.updates}</span>
          <span
            className={note && note.tone !== "plain" ? `writing-assist-row-note is-${note.tone}` : "writing-assist-row-note"}
            role="status"
            aria-live="polite"
            hidden={!note}
          >
            {note?.text}
          </span>
        </span>
        {available ? (
          <span className="writing-assist-links">
            {available.downloadUrl ? (
              <button type="button" className="writing-assist-link" onClick={() => void onDownloadUpdate()}>
                {labels.download}
              </button>
            ) : null}
            {available.releaseUrl ? (
              <button type="button" className="writing-assist-link" onClick={() => void onViewUpdateRelease()}>
                {labels.whatsNew}
              </button>
            ) : null}
          </span>
        ) : (
          <button
            type="button"
            className="writing-assist-link"
            disabled={updateChecking}
            onClick={() => void onCheckForUpdates()}
          >
            {labels.checkNow}
          </button>
        )}
      </div>
    </div>
  );
}
