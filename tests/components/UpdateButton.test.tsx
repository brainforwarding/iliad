import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UpdateButton, updatePercent, type UpdateButtonLabels } from "../../src/components/UpdateButton";
import type { AppLanguage } from "../../src/i18n/appLanguage";
import { appStrings } from "../../src/i18n/strings";
import type { AppUpdateState } from "../../src/types/iliad";

const noop = () => undefined;

function labels(language: AppLanguage): UpdateButtonLabels {
  const strings = appStrings[language];
  return { ...strings.updates, restartToUpdate: strings.settings.restartToUpdate };
}

function state(patch: Partial<AppUpdateState>): AppUpdateState {
  return {
    status: "idle",
    currentVersion: "0.6.0",
    version: "0.6.1",
    installWhenReady: false,
    restartPending: false,
    ...patch
  };
}

function render(patch: Partial<AppUpdateState>, { language = "en" as AppLanguage, confirming = false } = {}) {
  return renderToStaticMarkup(
    <UpdateButton
      state={state(patch)}
      labels={labels(language)}
      confirming={confirming}
      onInstall={noop}
      onOpenDownload={noop}
    />
  );
}

function attr(html: string, name: string) {
  return html.match(new RegExp(`${name}="([^"]*)"`))?.[1];
}

function pillLabel(html: string) {
  return html.match(/class="sidebar-update-(?:label|text)"[^>]*>([^<]*)</)?.[1];
}

describe("footer update button (0.6.2)", () => {
  it("draws a progress ring with ↓ while downloading in the background, still clickable", () => {
    for (const [percent, expected] of [
      [10, 10],
      [42, 42],
      [85, 85]
    ] as const) {
      const html = render({ status: "downloading", percent });
      expect(html).toMatch(/^<button type="button" class="sidebar-update-button is-progress"/);
      expect(html).toContain('class="sidebar-update-ring"');
      expect(html).toContain("lucide-arrow-down");
      expect(attr(html, "data-progress")).toBe(String(expected));
      expect(html).toContain(`stroke-dashoffset:${100 - expected}`);
      expect(html).toContain(`--update-progress:${expected}%`);
    }

    // "Available" is momentary: the empty ring.
    const available = render({ status: "available" });
    expect(attr(available, "data-progress")).toBe("0");
  });

  it("labels the background download in EN and ES", () => {
    const en = render({ status: "downloading", percent: 42 });
    expect(pillLabel(en)).toBe("Downloading 42%");
    expect(attr(en, "data-tooltip")).toBe("Downloading Iliad 0.6.1…");
    expect(attr(en, "aria-label")).toBe("Downloading update, 42%");

    const es = render({ status: "downloading", percent: 42 }, { language: "es" });
    expect(pillLabel(es)).toBe("Descargando 42%");
    expect(attr(es, "data-tooltip")).toBe("Descargando Iliad 0.6.1…");
    expect(attr(es, "aria-label")).toBe("Descargando actualización, 42%");
  });

  it("turns into the solid restart circle once ready, with the Settings words", () => {
    const en = render({ status: "ready" });
    expect(en).toMatch(/^<button type="button" class="sidebar-update-button is-ready"/);
    expect(en).toContain("lucide-rotate-cw");
    expect(en).not.toContain("lucide-arrow-down");
    expect(en).not.toContain("sidebar-update-ring");
    expect(pillLabel(en)).toBe(appStrings.en.settings.restartToUpdate);
    expect(pillLabel(en)).toBe("Restart to update");
    expect(attr(en, "data-tooltip")).toBe("Iliad 0.6.1 is ready. Restart to update");
    expect(attr(en, "aria-label")).toBe("Iliad 0.6.1 is ready. Restart to update");

    const es = render({ status: "ready" }, { language: "es" });
    expect(pillLabel(es)).toBe("Reiniciar para actualizar");
    expect(attr(es, "data-tooltip")).toBe("Iliad 0.6.1 está lista. Reiniciar para actualizar");
    expect(attr(es, "aria-label")).toBe("Iliad 0.6.1 está lista. Reiniciar para actualizar");
  });

  it("keeps the ready pill open under the confirmation", () => {
    const html = render({ status: "ready", restartPending: true }, { confirming: true });
    expect(html).toContain('class="sidebar-update-button is-ready is-expanded"');
    expect(pillLabel(html)).toBe("Restart to update");
  });

  it("stays expanded as Downloading after an early click, then Restarting…", () => {
    const downloading = render({ status: "downloading", percent: 85, installWhenReady: true }, { language: "es" });
    expect(downloading).toMatch(/^<span class="sidebar-update-button is-expanded is-busy" role="status"/);
    expect(pillLabel(downloading)).toBe("Descargando 85%");
    expect(attr(downloading, "data-tooltip")).toBe("Descargando Iliad 0.6.1…");
    expect(downloading).not.toContain("sidebar-update-ring");

    const restarting = render({ status: "ready", restartPending: true });
    expect(pillLabel(restarting)).toBe("Restarting…");
    expect(attr(restarting, "aria-label")).toBe("Restarting to update");
    expect(restarting).not.toContain("data-tooltip");
  });

  it("keeps the solid ↓ circle for copies that can't update themselves", () => {
    const html = render({ status: "unsupported" });
    expect(html).toMatch(/^<button type="button" class="sidebar-update-button"/);
    expect(html).toContain("lucide-arrow-down");
    expect(pillLabel(html)).toBe("Update");
    expect(attr(html, "data-tooltip")).toBe("Download Iliad 0.6.1");
    expect(attr(html, "aria-label")).toBe("Update Iliad to 0.6.1");
  });

  it("renders nothing when there is no update", () => {
    expect(render({ status: "current" })).toBe("");
  });

  it("clamps the percent to a whole number in 0–100", () => {
    expect(updatePercent(state({ percent: 41.6 }))).toBe(42);
    expect(updatePercent(state({ percent: 130 }))).toBe(100);
    expect(updatePercent(state({ percent: -3 }))).toBe(0);
    expect(updatePercent(null)).toBe(0);
  });
});
