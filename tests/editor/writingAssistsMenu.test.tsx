import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WritingAssistsMenu } from "../../src/components/WritingAssistsMenu";
import { defaultAutocompletePreferences } from "../../src/editor/ideaAutocomplete/options";
import { appStrings } from "../../src/i18n/strings";
import type { GeminiKeyState } from "../../src/types/iliad";

function render({
  language = "en" as "en" | "es",
  autocompleteEnabled = true,
  correctorAvailable = true,
  geminiKey = { hasKey: true, last4: "1234" } as GeminiKeyState | null,
  keyFieldFocusRequest = 0
} = {}) {
  const noop = () => undefined;
  return renderToStaticMarkup(
    <WritingAssistsMenu labels={appStrings[language].writingAssists} menuRef={createRef()} open onToggleOpen={noop}
      correctorEnabled={false} onSetCorrectorEnabled={noop} correctorAvailable={correctorAvailable}
      autocompleteEnabled={autocompleteEnabled} onSetAutocompleteEnabled={noop}
      geminiKey={geminiKey} onSaveGeminiKey={async () => undefined} onGetGeminiKey={noop} onOpenPrivacy={noop}
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
      "Accept", "Another", "Dismiss", "Reset shortcuts", "Gemini key", "Privacy"
    ]);
  });

  it("lists the same rows in Spanish", () => {
    expect(rowLabels(render({ language: "es" }))).toEqual([
      "Corrector", "Autocompletar", "Menú ✦ IA", "Oración", "Párrafo", "Idea completa",
      "Aceptar", "Otra", "Descartar", "Restablecer atajos", "Clave de Gemini", "Privacidad"
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
    expect(labels).toEqual(["Corrector", "Autocomplete", "Gemini key", "Privacy"]);
  });

  it("notes the corrector's limit while it is unavailable", () => {
    expect(render({ correctorAvailable: false })).toContain("English only for now");
    expect(render({ correctorAvailable: false, language: "es" })).toContain("Solo inglés por ahora");
    expect(render()).not.toContain("English only for now");
  });

  it("shows the Gemini key row with the masked key and a Change link", () => {
    const html = render();
    expect(html).toContain(">Gemini key<");
    expect(html).toContain(">••••1234<");
    expect(html).toMatch(/class="writing-assist-link"[^>]*>Change</);
    expect(html).not.toContain('type="password"');
  });

  it("offers Add key without a key and opens the form in place when ✦ AI asks for one", () => {
    const collapsed = render({ geminiKey: { hasKey: false, last4: null } });
    expect(collapsed).toMatch(/class="writing-assist-link"[^>]*>Add key</);
    expect(collapsed).not.toContain('type="password"');

    const open = render({ geminiKey: { hasKey: false, last4: null }, keyFieldFocusRequest: 1 });
    expect(open).toContain('type="password"');
    expect(open).toContain("Get a key");
    expect(rowLabels(open)).toContain("Gemini API key");
    expect(open.indexOf('type="password"')).toBeGreaterThan(open.indexOf("Reset shortcuts"));
  });

  it("carries no Codex, OpenAI, or API-fallback copy", () => {
    const html = render() + render({ geminiKey: { hasKey: false, last4: null }, keyFieldFocusRequest: 1 });
    expect(html).not.toMatch(/codex|openai|fallback|Using Gemini/i);
  });
});
