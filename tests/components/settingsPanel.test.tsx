import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GeneralSettings, updateRowNote } from "../../src/components/settings/GeneralSettings";
import { SettingsPanel } from "../../src/components/settings/SettingsPanel";
import { TypographySettings } from "../../src/components/settings/TypographySettings";
import { WorkspaceMenu } from "../../src/components/WorkspaceMenu";
import { appStrings } from "../../src/i18n/strings";
import type { SettingsTab } from "../../src/preferences/settingsTab";
import type { UpdateCheckResult } from "../../src/types/iliad";

const noop = () => undefined;

function panel({ tab = "general" as SettingsTab, language = "en" as "en" | "es", updateAvailable = false } = {}) {
  return renderToStaticMarkup(
    <SettingsPanel labels={appStrings[language].settings} tab={tab} onSelectTab={noop} updateAvailable={updateAvailable}>
      <p>body</p>
    </SettingsPanel>
  );
}

function general({ status = null as UpdateCheckResult | null, checking = false, language = "en" as "en" | "es" } = {}) {
  const strings = appStrings[language];
  return renderToStaticMarkup(
    <GeneralSettings
      labels={{ ...strings.settings, english: strings.language.english, spanish: strings.language.spanish }}
      language={language}
      onSetLanguage={noop}
      version="0.4.0"
      updateStatus={status}
      updateChecking={checking}
      onCheckForUpdates={noop}
      onDownloadUpdate={noop}
      onViewUpdateRelease={noop}
    />
  );
}

const AVAILABLE: UpdateCheckResult = {
  status: "available",
  currentVersion: "0.4.0",
  latestVersion: "0.5.0",
  releaseName: "0.5.0",
  releaseDate: "2026-09-27",
  releaseUrl: "https://example.test/release",
  downloadUrl: "https://example.test/dmg"
};

function tabLabels(html: string) {
  return [...html.matchAll(/role="tab"[^>]*>([^<]*)</g)].map((match) => match[1]);
}

function rowLabels(html: string) {
  return [...html.matchAll(/class="writing-assist-row-label"[^>]*>([^<]*)</g)].map((match) => match[1]);
}

describe("Settings panel", () => {
  it("is a non-modal dialog with the content above bottom tabs", () => {
    const html = panel();
    expect(html).toMatch(/^<div class="settings-panel" role="dialog" aria-modal="false" aria-label="Settings">/);
    expect(html.indexOf('role="tabpanel"')).toBeLessThan(html.indexOf('role="tablist"'));
    expect(html).toContain('role="tablist" aria-label="Settings sections"');
  });

  it("labels the tabs General · Typography · Writing (EN) and General · Tipografía · Escritura (ES)", () => {
    expect(tabLabels(panel())).toEqual(["General", "Typography", "Writing"]);
    expect(tabLabels(panel({ language: "es" }))).toEqual(["General", "Tipografía", "Escritura"]);
  });

  it("marks only the active tab selected and focusable, and ties it to the tab panel", () => {
    const html = panel({ tab: "typography" });
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-selected="true"[^>]*tabindex="0"[^>]*>Typography</);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(2);
    const selectedId = html.match(/id="([^"]+)" class="settings-tab is-active"/)?.[1];
    expect(selectedId).toBeTruthy();
    expect(html).toContain(`aria-labelledby="${selectedId}"`);
    const panelId = html.match(/role="tabpanel" id="([^"]+)"/)?.[1];
    expect(html).toContain(`aria-controls="${panelId}"`);
  });

  it("shows the update dot on the General tab only when an update is available", () => {
    expect(panel()).not.toContain("settings-tab-dot");
    const html = panel({ updateAvailable: true });
    expect(html.match(/settings-tab-dot/g)).toHaveLength(1);
    expect(html).toContain('aria-label="General, update available"');
    expect(panel({ updateAvailable: true, language: "es" })).toContain('aria-label="General, actualización disponible"');
  });
});

describe("General settings", () => {
  it("shows App language, Version and Updates rows (EN/ES)", () => {
    const html = general();
    expect(rowLabels(html)).toEqual(["App language", "Version", "Updates"]);
    expect(html).toContain(">Iliad MD 0.4.0<");
    expect(html).toMatch(/aria-pressed="true"[^>]*>English</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Español</);
    expect(html).toMatch(/class="writing-assist-link"[^>]*>Check now</);
    expect(rowLabels(general({ language: "es" }))).toEqual(["Idioma de la app", "Versión", "Actualizaciones"]);
    expect(general({ language: "es" })).toContain(">Buscar ahora<");
  });

  it("walks through the update states", () => {
    const checking = general({ checking: true });
    expect(checking).toContain(">Checking…<");
    expect(checking).toMatch(/disabled=""[^>]*>Check now</);

    expect(general({ status: { status: "current", currentVersion: "0.4.0", latestVersion: "0.4.0" } })).toContain(">Up to date<");

    const failed = general({ status: { status: "error", currentVersion: "0.4.0", message: "x" } });
    expect(failed).toContain("writing-assist-row-note is-error");
    expect(failed).toContain(">Couldn&#x27;t check for updates<");

    const ready = general({ status: AVAILABLE });
    expect(ready).toContain(">Iliad MD 0.5.0 is ready<");
    expect(ready).toMatch(/class="writing-assist-link"[^>]*>Download</);
    expect(ready).toMatch(/class="writing-assist-link"[^>]*>What&#x27;s new</);
    expect(ready).not.toContain("Check now");
    expect(general({ status: AVAILABLE, language: "es" })).toContain(">Iliad MD 0.5.0 está lista<");
  });

  it("says nothing about updates before a check", () => {
    expect(updateRowNote(null, false, appStrings.en.settings)).toBeNull();
    expect(general()).toMatch(/role="status" aria-live="polite" hidden=""/);
  });
});

describe("Typography settings", () => {
  it("shows Font, Size and Reset rows with the size in px", () => {
    const html = renderToStaticMarkup(
      <TypographySettings
        editorFontPreset="sans"
        editorFontSize={24}
        labels={{ ...appStrings.en.typography, font: "Font", size: "Size", sizeValue: appStrings.en.settings.sizeValue }}
        onReset={noop}
        onSetFontPreset={noop}
        onSetFontSize={noop}
      />
    );
    expect(rowLabels(html)).toEqual(["Font", "Size", "Reset"]);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Sans</);
    expect(html).toContain(">24 px<");
    // At the maximum, A+ is disabled and A− is not.
    expect(html).toMatch(/aria-label="Increase editor font size" disabled=""/);
    expect(html).not.toMatch(/aria-label="Decrease editor font size" disabled=""/);
  });
});

describe("Workspace menu", () => {
  it("no longer carries the update check (it lives in Settings → General)", () => {
    const html = renderToStaticMarkup(
      <WorkspaceMenu
        defaultOpen
        workspace={{ name: "Notes", path: "/Users/me/Notes" } as never}
        recentWorkspaces={[]}
        labels={appStrings.en.sidebar}
        onOpenFolder={noop}
        onCreateFolder={noop}
        onOpenRecent={noop}
        onRevealWorkspace={noop}
      />
    );
    expect(html).toContain("Open folder");
    expect(html).not.toMatch(/update/i);
    expect(html).not.toContain(appStrings.en.updates.checkForUpdates);
  });
});
