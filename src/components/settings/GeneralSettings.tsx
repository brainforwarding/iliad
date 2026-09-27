import type { AppLanguage } from "../../i18n/appLanguage";
import type { AppStrings } from "../../i18n/strings";
import type { AppUpdateState } from "../../types/iliad";
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
  | "available"
  | "downloadingVersion"
  | "restarting"
  | "restartToUpdate"
  | "cantSelfUpdate"
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
  update: AppUpdateState | null;
  onCheckForUpdates: () => void | Promise<void>;
  onInstallUpdate: () => void;
  onOpenDownload: () => void;
  onOpenReleaseNotes: () => void;
}

export type UpdateRowAction = "check" | "restart" | "download";

export interface UpdateRowView {
  /** The row's headline: "Updates", or the update itself once there is one. */
  label: string;
  note: { text: string; tone: "plain" | "error" } | null;
  /** The action on the right (none while downloading or restarting). */
  action: UpdateRowAction | null;
  /** "What's new" (the release page) under the headline. */
  whatsNew: boolean;
  /** Check now is disabled while a manual check runs. */
  busy: boolean;
}

/**
 * The Updates row in words (spec 2026-09-27, Figma frame 7): up to date /
 * downloading / ready (Restart to update) / can't update itself (Download) /
 * couldn't check. Nothing is said before the first check.
 */
export function updateRowView(state: AppUpdateState | null, labels: GeneralSettingsLabels): UpdateRowView {
  const version = state?.version ?? "";
  const plain = (text: string) => ({ text, tone: "plain" as const });

  switch (state?.status) {
    case "checking":
      return { label: labels.updates, note: plain(labels.checking), action: "check", whatsNew: false, busy: true };
    case "current":
      return { label: labels.updates, note: plain(labels.upToDate), action: "check", whatsNew: false, busy: false };
    case "error":
      return {
        label: labels.updates,
        note: { text: labels.checkFailed, tone: "error" },
        action: "check",
        whatsNew: false,
        busy: false
      };
    case "available":
    case "downloading":
      return {
        label: labels.downloadingVersion(version, state.percent ?? 0),
        note: null,
        action: null,
        whatsNew: false,
        busy: false
      };
    case "ready":
      return state.restartPending
        ? { label: labels.ready(version), note: plain(labels.restarting), action: null, whatsNew: true, busy: false }
        : { label: labels.ready(version), note: null, action: "restart", whatsNew: true, busy: false };
    case "installing":
      return { label: labels.ready(version), note: plain(labels.restarting), action: null, whatsNew: false, busy: false };
    case "unsupported":
      return {
        label: labels.available(version),
        note: plain(labels.cantSelfUpdate),
        action: "download",
        whatsNew: false,
        busy: false
      };
    default:
      return { label: labels.updates, note: null, action: "check", whatsNew: false, busy: false };
  }
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
  update,
  onCheckForUpdates,
  onInstallUpdate,
  onOpenDownload,
  onOpenReleaseNotes
}: GeneralSettingsProps) {
  const row = updateRowView(update, labels);

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
          <span className="writing-assist-row-label" role="status" aria-live="polite">
            {row.label}
          </span>
          <span
            className={row.note?.tone === "error" ? "writing-assist-row-note is-error" : "writing-assist-row-note"}
            hidden={!row.note}
          >
            {row.note?.text}
          </span>
          {row.whatsNew ? (
            <button type="button" className="writing-assist-link settings-updates-whats-new" onClick={onOpenReleaseNotes}>
              {labels.whatsNew}
            </button>
          ) : null}
        </span>
        {row.action === "check" ? (
          <button type="button" className="writing-assist-link" disabled={row.busy} onClick={() => void onCheckForUpdates()}>
            {labels.checkNow}
          </button>
        ) : row.action === "restart" ? (
          <button type="button" className="writing-assist-link" onClick={onInstallUpdate}>
            {labels.restartToUpdate}
          </button>
        ) : row.action === "download" ? (
          <button type="button" className="writing-assist-link" onClick={onOpenDownload}>
            {labels.download}
          </button>
        ) : null}
      </div>
    </div>
  );
}
