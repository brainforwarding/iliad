import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WritingAssistsMenu } from "../../src/components/WritingAssistsMenu";
import { defaultAutocompletePreferences } from "../../src/editor/ideaAutocomplete/options";
import { appStrings } from "../../src/i18n/strings";
import type { GroqKeyState } from "../../src/types/iliad";

const FREE: GroqKeyState = { state: "none", last4: null, rejected: false };
const OWN_KEY: GroqKeyState = { state: "ok", last4: "1234", rejected: false };

function render({
  language = "en" as "en" | "es",
  autocompleteEnabled = true,
  correctorAvailable = true,
  groqKey = FREE as GroqKeyState | null,
  keyFieldFocusRequest = 0
} = {}) {
  const noop = () => undefined;
  return renderToStaticMarkup(
    <WritingAssistsMenu labels={appStrings[language].writingAssists} menuRef={createRef()} open onToggleOpen={noop}
      correctorEnabled={false} onSetCorrectorEnabled={noop} correctorAvailable={correctorAvailable}
      autocompleteEnabled={autocompleteEnabled} onSetAutocompleteEnabled={noop}
      groqKey={groqKey} onSaveGroqKey={async () => ({ ok: true, state: FREE })} onGetGroqKey={noop} onOpenPrivacy={noop}
      keyFieldFocusRequest={keyFieldFocusRequest}
      preferences={defaultAutocompletePreferences} onPreferencesChange={noop} onResetShortcuts={noop} />
  );
}

/** The visible row labels, in order. */
function rowLabels(html: string) {
  return [...html.matchAll(/class="writing-assist-row-label"[^>]*>([^<]*)</g)].map((match) => match[1]);
}

describe("Writing assists menu", () => {
  it("lists every item as one row, in the spec order (EN)", () => {
    expect(rowLabels(render())).toEqual([
      "Corrector", "Autocomplete", "✦ AI menu", "Sentence", "Paragraph", "Full idea",
      "Accept", "Another", "Dismiss", "Reset shortcuts", "AI included", "Privacy"
    ]);
  });

  it("lists the same rows in Spanish", () => {
    expect(rowLabels(render({ language: "es" }))).toEqual([
      "Corrector", "Autocompletar", "Menú ✦ IA", "Oración", "Párrafo", "Idea completa",
      "Aceptar", "Otra", "Descartar", "Restablecer atajos", "IA incluida", "Privacidad"
    ]);
  });

  it("has no collapsible section, checkbox, pill button, helper text, notes or pause", () => {
    const html = render();
    expect(html).not.toContain("<details");
    expect(html).not.toContain("<summary");
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain("writing-assist-quiet");
    expect(html).not.toContain("writing-assist-key-save");
    for (const gone of ["Open notes", "Suggest while I type", "Pause for 10 min", "Announce suggestions", "Shortcuts &amp; accessibility",
      "Click a key", "press again", "Phrase", "Example", "Transition", "Tension", "Continue with", "One word"]) {
      expect(html).not.toContain(gone);
    }
  });

  it("keeps four remappable key selects with duplicate keys blocked", () => {
    const html = render();
    expect(html.match(/<select/g)).toHaveLength(4);
    expect(html).toContain('<option value="Mod-/" selected="">');
    // A key already used by another action is disabled in this select.
    expect(html).toMatch(/<option value="Mod-,"[^>]*disabled=""/);
    expect(html).toContain(">Tab<");
    expect(html).toContain(">Esc<");
  });

  it("shows key rows only while Autocomplete is on", () => {
    const labels = rowLabels(render({ autocompleteEnabled: false }));
    expect(labels).toEqual(["Corrector", "Autocomplete", "AI included", "Privacy"]);
  });

  it("notes the corrector's limit while it is unavailable", () => {
    expect(render({ correctorAvailable: false })).toContain("English only for now");
    expect(render({ correctorAvailable: false, language: "es" })).toContain("Solo inglés por ahora");
    expect(render()).not.toContain("English only for now");
  });

  it("shows the free route as AI included, with a daily limit and Use my key (EN/ES)", () => {
    const en = render();
    expect(en).toContain(">AI included<");
    expect(en).toContain(">Free, with a daily limit<");
    expect(en).toMatch(/class="writing-assist-link"[^>]*>Use my key</);
    expect(en).not.toContain('type="password"');
    const es = render({ language: "es" });
    expect(es).toContain(">IA incluida<");
    expect(es).toContain(">Gratis, con un límite diario<");
    expect(es).toMatch(/class="writing-assist-link"[^>]*>Usar mi clave</);
    expect(es).not.toMatch(/llave/i);
  });

  it("shows an own key as Groq key ••••1234 with Change and Remove", () => {
    const html = render({ groqKey: OWN_KEY });
    expect(rowLabels(html)).toContain("Groq key");
    expect(html).toContain(">••••1234<");
    expect(html).toMatch(/class="writing-assist-link"[^>]*>Change</);
    expect(html).toMatch(/class="writing-assist-link"[^>]*>Remove</);
    expect(html).not.toContain("AI included");
    const es = render({ language: "es", groqKey: OWN_KEY });
    expect(rowLabels(es)).toContain("Clave de Groq");
    expect(es).toMatch(/>Cambiar</);
    expect(es).toMatch(/>Quitar</);
  });

  it("shows the unreadable and rejected key states in the row's note", () => {
    const unreadable = render({ groqKey: { state: "unreadable", last4: null, rejected: false } });
    expect(unreadable).toContain("Re-enter your key");
    expect(unreadable).toContain("writing-assist-row-note is-error");
    expect(render({ language: "es", groqKey: { state: "unreadable", last4: null, rejected: false } })).toContain("Vuelve a ingresar tu clave");
    const rejected = render({ groqKey: { ...OWN_KEY, rejected: true } });
    expect(rejected).toContain("Groq rejected this key");
    expect(rejected).toContain("••••1234");
  });

  it("opens the key form in place of the row when a notice asks for a key (EN/ES)", () => {
    const open = render({ keyFieldFocusRequest: 1 });
    expect(open).toContain('type="password"');
    expect(rowLabels(open)).toContain("Groq API key");
    expect(open).toContain('placeholder="Paste your Groq API key"');
    expect(open).toContain("Goes straight to Groq, with no daily limit from Iliad.");
    for (const action of ["Save", "Cancel", "Get a key"]) expect(open).toMatch(new RegExp(`class="writing-assist-link"[^>]*>${action}<`));
    expect(open).not.toMatch(/>Remove</);
    expect(open.indexOf('type="password"')).toBeGreaterThan(open.indexOf("Reset shortcuts"));
    expect(open).not.toContain("AI included");

    const es = render({ language: "es", keyFieldFocusRequest: 1 });
    expect(rowLabels(es)).toContain("Clave API de Groq");
    expect(es).toContain('placeholder="Pega tu clave API de Groq"');
    expect(es).toContain("Va directo a Groq, sin límite diario de Iliad.");
    for (const action of ["Guardar", "Cancelar", "Obtener una clave"]) expect(es).toContain(`>${action}<`);

    // With a saved key the expanded form also offers Remove.
    expect(render({ groqKey: OWN_KEY, keyFieldFocusRequest: 1 })).toMatch(/>Remove</);
  });

  it("carries no Gemini, Codex, OpenAI, or API-fallback copy, and never a count", () => {
    const html = render() + render({ keyFieldFocusRequest: 1 }) + render({ groqKey: OWN_KEY }) + render({ language: "es", keyFieldFocusRequest: 1 });
    expect(html).not.toMatch(/gemini|codex|openai|fallback/i);
    expect(html).not.toMatch(/\d+ (left|requests|restantes)/i);
  });
});
