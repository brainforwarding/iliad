import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WritingAssistsMenu } from "../../src/components/WritingAssistsMenu";
import { defaultAutocompletePreferences } from "../../src/editor/ideaAutocomplete/options";
import { appStrings } from "../../src/i18n/strings";
import type { GeminiKeyState } from "../../src/types/iliad";

function render({ manualOnly = false, geminiKey = { hasKey: true, last4: "1234" } as GeminiKeyState | null } = {}) {
  const noop = () => undefined;
  return renderToStaticMarkup(
    <WritingAssistsMenu labels={appStrings.en.writingAssists} menuRef={createRef()} open onToggleOpen={noop}
      correctorEnabled={false} onSetCorrectorEnabled={noop} correctorAvailable
      autocompleteEnabled onSetAutocompleteEnabled={noop}
      geminiKey={geminiKey} onSaveGeminiKey={async () => undefined} onGetGeminiKey={noop}
      notesAvailable hasNotes={false} onOpenNotes={noop} preferences={{ ...defaultAutocompletePreferences, manualOnly }} onPreferencesChange={noop}
      snoozed={false} onToggleSnooze={noop} onResetShortcuts={noop} />
  );
}

describe("Writing assists menu", () => {
  it("offers one Open notes action instead of inline note fields", () => {
    const html = render();
    expect(html).toContain("Open notes");
    expect(html).not.toContain("Use for this document");
    expect(html).not.toContain("Voice &amp; audience");
    expect(html).not.toContain("<textarea");
  });

  it("holds settings only: lengths are key settings, not action buttons", () => {
    const html = render();
    for (const gone of ["Phrase", "Example", "Transition", "Tension", "Continue with", "One word"]) {
      expect(html).not.toContain(gone);
    }
    expect(html).not.toMatch(/<button[^>]*>(Sentence|Paragraph)</);
    expect(html).toContain("Suggest while I type");
    // AI key + Sentence + Paragraph + Full idea, each remappable, never duplicated.
    expect(html.match(/<select/g)).toHaveLength(4);
    expect(html).toContain('<option value="Mod-/" selected="">');
  });

  it("explains the manual-only state with the configured key", () => {
    expect(render({ manualOnly: true })).toContain("Off: only when you press");
  });

  it("puts the Gemini key field first when no key is set", () => {
    const html = render({ geminiKey: { hasKey: false, last4: null } });
    expect(html.indexOf("Gemini API key")).toBeGreaterThan(-1);
    expect(html.indexOf("Gemini API key")).toBeLessThan(html.indexOf("Corrector"));
    expect(html).toContain('type="password"');
    expect(html).toContain("Get a key");
  });

  it("shows a quiet last row with the masked key when one is set", () => {
    const html = render();
    expect(html).toContain("Gemini key ••••1234");
    expect(html).toContain("Change");
    expect(html).not.toContain('type="password"');
    expect(html.indexOf("Gemini key ••••1234")).toBeGreaterThan(html.indexOf("Corrector"));
  });

  it("carries no Codex, OpenAI, or API-fallback copy", () => {
    const html = render() + render({ geminiKey: { hasKey: false, last4: null } });
    expect(html).not.toMatch(/codex|openai|fallback|Using Gemini/i);
  });
});
