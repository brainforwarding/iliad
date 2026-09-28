import { describe, expect, it } from "vitest";
import { appStrings } from "../../src/i18n/strings";

type Shape = string | { [key: string]: Shape };

function shape(value: unknown): Shape {
  if (typeof value === "function") {
    return `function/${(value as (...args: unknown[]) => unknown).length}`;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, shape((value as Record<string, unknown>)[key])])
    );
  }

  return typeof value;
}

describe("app strings", () => {
  it("have the same keys (and function arities) in English and Spanish", () => {
    expect(shape(appStrings.es)).toEqual(shape(appStrings.en));
  });

  it("carry the update copy from the spec in both languages", () => {
    expect(appStrings.en.updates.update).toBe("Update");
    expect(appStrings.es.updates.update).toBe("Actualizar");
    expect(appStrings.en.updates.updateAria("0.6.1")).toBe("Update Iliad to 0.6.1");
    expect(appStrings.en.updates.downloadingAria(42)).toBe("Downloading update, 42%");
    expect(appStrings.en.updates.downloading(42)).toBe("Downloading 42%");
    expect(appStrings.es.updates.downloading(42)).toBe("Descargando 42%");
    expect(appStrings.es.updates.restarting).toBe("Reiniciando…");
    expect(appStrings.en.updates.confirmTitle).toBe("Restart to update?");
    expect(appStrings.en.updates.confirmBody).toBe("Unreviewed changes from your agent will be kept as they are.");
    expect(appStrings.es.updates.confirmTitle).toBe("¿Reiniciar para actualizar?");
    expect(appStrings.es.updates.confirmBody).toBe("Los cambios de tu agente sin revisar quedarán tal como están.");
    expect(appStrings.en.settings.cantSelfUpdate).toBe("This copy can't update itself.");
    expect(appStrings.en.updates.downloadingTooltip("0.6.1")).toBe("Downloading Iliad 0.6.1…");
    expect(appStrings.es.updates.downloadingTooltip("0.6.1")).toBe("Descargando Iliad 0.6.1…");
    expect(appStrings.en.updates.readyTooltip("0.6.1")).toBe("Iliad 0.6.1 is ready. Restart to update");
    expect(appStrings.es.updates.readyTooltip("0.6.1")).toBe("Iliad 0.6.1 está lista. Reiniciar para actualizar");
  });

  it("no longer carry the amber-dot or toast copy", () => {
    expect(JSON.stringify(Object.keys(appStrings.en.sidebar))).not.toContain("settingsUpdateAvailable");
    expect(JSON.stringify(Object.keys(appStrings.en.settings))).not.toContain("tabUpdateAvailable");
    expect(Object.keys(appStrings.en.updates)).not.toContain("viewRelease");
  });
});
