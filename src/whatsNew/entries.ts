import type { AppLanguage } from "../i18n/appLanguage";

/**
 * One-time "What's new" cards, bundled in the app and written per release
 * (spec 2026-09-27 in-app updates). Most patch releases have none. Keyed by
 * the exact app version; the card shows once, on the first launch of that
 * version, and only for someone who used Iliad before.
 */
export interface WhatsNewEntry {
  version: string;
  title: Record<AppLanguage, string>;
  body: Record<AppLanguage, string>;
  /** A small built-in illustration (drawn in HTML/CSS, never an image file). */
  illustration?: "update-pill";
}

export const whatsNewEntries: readonly WhatsNewEntry[] = [
  {
    version: "0.6.0",
    title: {
      en: "Iliad updates itself now",
      es: "Iliad ahora se actualiza solo"
    },
    body: {
      en: "When a new version is ready, click Update at the bottom of the sidebar. Iliad saves your work and reopens.",
      es: "Cuando haya una versión nueva, haz clic en Actualizar abajo en la barra lateral. Iliad guarda tu trabajo y se vuelve a abrir."
    },
    illustration: "update-pill"
  }
];
