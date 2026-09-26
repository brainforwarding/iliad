import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiNoticeBar } from "../../src/components/AiNoticeBar";
import { aiNoticeForReason, formatResetTime, nextUtcMidnight } from "../../src/editor/aiNotice";
import { appStrings } from "../../src/i18n/strings";

const RESET = "2026-09-26T00:00:00.000Z";
const labels = { en: appStrings.en.editor.aiNotices, es: appStrings.es.editor.aiNotices };

function notice(reason: Parameters<typeof aiNoticeForReason>[0], language: "en" | "es" = "en", route: "free" | "own-key" | "blocked" | null = "free") {
  return aiNoticeForReason(reason, { route, resetAt: RESET, language, labels: labels[language], timeZone: "America/Santiago" });
}

describe("AI notices (Groq spec §8)", () => {
  it("formats resetAt as a local time in the app language's locale", () => {
    // 00:00 UTC is 21:00 the day before in Chile (UTC-3).
    expect(formatResetTime(RESET, "en", 0, "America/Santiago")).toBe("9:00 PM");
    expect(formatResetTime(RESET, "es", 0, "America/Santiago")).toBe("21:00");
    // Without resetAt it falls back to the next 00:00 UTC.
    expect(nextUtcMidnight(Date.parse("2026-09-25T23:59:59.999Z")).toISOString()).toBe(RESET);
    expect(formatResetTime(undefined, "es", Date.parse("2026-09-25T12:00:00Z"), "UTC")).toBe("0:00");
  });

  it("uses one message for every free 'out' refusal, with Use my key", () => {
    expect(notice("free_exhausted")).toEqual({ message: "Today's free AI has run out. It's back at 9:00 PM.", action: "use-key" });
    expect(notice("free_exhausted", "es")).toEqual({ message: "La IA gratis de hoy se agotó. Vuelve a las 21:00.", action: "use-key" });
    const madrid = aiNoticeForReason("free_exhausted", { route: "free", resetAt: RESET, language: "es", labels: labels.es, timeZone: "Europe/Madrid" });
    expect(madrid?.message).toBe("La IA gratis de hoy se agotó. Vuelve a las 2:00.");
    // "a la 1:00" is singular.
    const lagos = aiNoticeForReason("free_exhausted", { route: "free", resetAt: RESET, language: "es", labels: labels.es, timeZone: "Africa/Lagos" });
    expect(lagos?.message).toBe("La IA gratis de hoy se agotó. Vuelve a la 1:00.");
  });

  it("maps every notice reason to its copy in EN and ES; free notices offer the key, own-key ones never the free route", () => {
    const expected: Array<[Parameters<typeof aiNoticeForReason>[0], "free" | "own-key", string, string, "use-key" | "update-key" | null]> = [
      ["free_unavailable", "free", "Free AI is paused right now.", "La IA gratis está en pausa por ahora.", "use-key"],
      ["client_outdated", "free", "Update Iliad to keep using free AI.", "Actualiza Iliad para seguir usando la IA gratis.", "use-key"],
      ["unreachable", "free", "Free AI isn't reachable. Check your connection.", "No se pudo conectar con la IA gratis. Revisa tu conexión.", "use-key"],
      ["unreachable", "own-key", "Couldn't reach Groq. Check your connection.", "No se pudo conectar con Groq. Revisa tu conexión.", null],
      ["invalid_api_key", "own-key", "Groq rejected your key. Check it in Writing assists.", "Groq rechazó tu clave. Revísala en Ayudas de escritura.", "update-key"],
      ["rate_limited", "own-key", "Your Groq key hit its rate limit. Try again shortly.", "Tu clave de Groq llegó a su límite. Intenta de nuevo en un momento.", null],
      ["key_unreadable", "own-key", "Re-enter your Groq key in Writing assists.", "Vuelve a ingresar tu clave de Groq en Ayudas de escritura.", "update-key"]
    ];
    for (const [reason, route, en, es, action] of expected) {
      expect(notice(reason, "en", route)).toEqual({ message: en, action });
      expect(notice(reason, "es", route)).toEqual({ message: es, action });
      if (route === "own-key") expect(`${en} ${es}`).not.toMatch(/free|gratis/i);
    }
    for (const reason of ["provider", "timeout", "no_suggestion", "too_long", "incomplete", "blocked"] as const) {
      expect(notice(reason)).toBeNull();
    }
  });

  it("never shows a count and uses 'clave', never 'llave'", () => {
    const all = JSON.stringify(labels) + JSON.stringify(appStrings.es.writingAssists);
    expect(all).not.toMatch(/llave/i);
    expect(notice("free_exhausted")?.message).not.toMatch(/\d+ (left|requests)/);
  });

  it("renders the notice bar with its action and a dismiss button", () => {
    const html = renderToStaticMarkup(createElement(AiNoticeBar, {
      notice: { message: "Today's free AI has run out. It's back at 9:00 PM.", action: "use-key" },
      labels: labels.en,
      onAction: () => undefined,
      onDismiss: () => undefined
    }));
    expect(html).toContain('role="status"');
    expect(html).toContain(">Use my key<");
    expect(html).toContain('aria-label="Dismiss"');
    const es = renderToStaticMarkup(createElement(AiNoticeBar, {
      notice: { message: "x", action: "update-key" },
      labels: labels.es,
      onAction: () => undefined,
      onDismiss: () => undefined
    }));
    expect(es).toContain(">Actualizar clave<");
  });
});
