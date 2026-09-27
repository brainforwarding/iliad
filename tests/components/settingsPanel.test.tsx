import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GeneralSettings, updateRowView } from "../../src/components/settings/GeneralSettings";
import { SettingsPanel } from "../../src/components/settings/SettingsPanel";
import { TypographySettings } from "../../src/components/settings/TypographySettings";
import { WorkspaceMenu } from "../../src/components/WorkspaceMenu";
import { appStrings } from "../../src/i18n/strings";
import type { SettingsTab } from "../../src/preferences/settingsTab";
import type { AppUpdateState } from "../../src/types/iliad";

const noop = () => undefined;

function panel({ tab = "general" as SettingsTab, language = "en" as "en" | "es" } = {}) {
  return renderToStaticMarkup(
    <SettingsPanel labels={appStrings[language].settings} tab={tab} onSelectTab={noop}>
      <p>body</p>
    </SettingsPanel>
  );
}

function general({ state = null as AppUpdateState | null, language = "en" as "en" | "es" } = {}) {
  const strings = appStrings[language];
  return renderToStaticMarkup(
    <GeneralSettings
      labels={{ ...strings.settings, english: strings.language.english, spanish: strings.language.spanish }}
      language={language}
      onSetLanguage={noop}
      version="0.6.0"
      update={state}
      onCheckForUpdates={noop}
      onInstallUpdate={noop}
      onOpenDownload={noop}
      onOpenReleaseNotes={noop}
    />
  );
}

function update(patch: Partial<AppUpdateState>): AppUpdateState {
  return { status: "idle", currentVersion: "0.6.0", installWhenReady: false, restartPending: false, ...patch };
}

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

  it("has no update dot on the General tab (the footer button replaces it)", () => {
    expect(panel()).not.toContain("settings-tab-dot");
    expect(panel()).not.toMatch(/update available|actualización disponible/);
  });
});

describe("General settings", () => {
  it("shows App language, Version and Updates rows (EN/ES)", () => {
    const html = general();
    expect(rowLabels(html)).toEqual(["App language", "Version", "Updates"]);
    expect(html).toContain(">Iliad MD 0.6.0<");
    expect(html).toMatch(/aria-pressed="true"[^>]*>English</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Español</);
    expect(html).toMatch(/class="writing-assist-link"[^>]*>Check now</);
    expect(rowLabels(general({ language: "es" }))).toEqual(["Idioma de la app", "Versión", "Actualizaciones"]);
    expect(general({ language: "es" })).toContain(">Buscar ahora<");
  });

  it("walks through the update states (Figma frame 7)", () => {
    const checking = general({ state: update({ status: "checking" }) });
    expect(checking).toContain(">Checking…<");
    expect(checking).toMatch(/disabled=""[^>]*>Check now</);

    expect(general({ state: update({ status: "current" }) })).toContain(">Up to date<");

    const failed = general({ state: update({ status: "error" }) });
    expect(failed).toContain("writing-assist-row-note is-error");
    expect(failed).toContain(">Couldn&#x27;t check for updates.<");
    expect(failed).toMatch(/>Check now</);

    const downloading = general({ state: update({ status: "downloading", version: "0.6.1", percent: 42 }) });
    expect(downloading).toContain(">Downloading 0.6.1… 42%<");
    expect(downloading).not.toContain("Check now");
    expect(general({ state: update({ status: "available", version: "0.6.1", percent: 0 }) })).toContain(">Downloading 0.6.1… 0%<");

    const ready = general({ state: update({ status: "ready", version: "0.6.1", releaseUrl: "https://example.test/r" }) });
    expect(ready).toContain(">Iliad 0.6.1 is ready<");
    expect(ready).toMatch(/class="writing-assist-link"[^>]*>Restart to update</);
    expect(ready).toMatch(/settings-updates-whats-new"[^>]*>What&#x27;s new</);
    expect(ready).not.toContain("Check now");
    expect(general({ state: update({ status: "ready", version: "0.6.1", restartPending: true }) })).toContain(">Restarting…<");
    expect(general({ state: update({ status: "ready", version: "0.6.1" }), language: "es" })).toContain(">Iliad 0.6.1 está lista<");

    const unsupported = general({ state: update({ status: "unsupported", version: "0.6.1", downloadUrl: "https://example.test/dmg" }) });
    expect(unsupported).toContain(">Iliad 0.6.1 is available<");
    expect(unsupported).toContain(">This copy can&#x27;t update itself.<");
    expect(unsupported).toMatch(/class="writing-assist-link"[^>]*>Download</);
    expect(general({ state: update({ status: "unsupported", version: "0.6.1" }), language: "es" })).toContain(
      ">Esta copia no puede actualizarse sola.<"
    );
  });

  it("says nothing about updates before a check", () => {
    expect(updateRowView(null, { ...appStrings.en.settings, english: "", spanish: "" }).note).toBeNull();
    expect(updateRowView(update({ status: "idle" }), { ...appStrings.en.settings, english: "", spanish: "" }).action).toBe("check");
    expect(general()).toMatch(/class="writing-assist-row-note" hidden=""/);
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
