import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WritingAssistsMenu } from "../../src/components/WritingAssistsMenu";
import { defaultAutocompletePreferences, emptyWritingGuidance } from "../../src/editor/ideaAutocomplete/options";
import { appStrings } from "../../src/i18n/strings";

function render(manualOnly = false) {
  const noop = () => undefined;
  return renderToStaticMarkup(
    <WritingAssistsMenu labels={appStrings.en.writingAssists} menuRef={createRef()} open onToggleOpen={noop}
      correctorEnabled={false} onSetCorrectorEnabled={noop} correctorAvailable
      autocompleteEnabled onSetAutocompleteEnabled={noop} autocompleteApiFallbackEnabled={false} onSetAutocompleteApiFallbackEnabled={noop}
      showApiFallback={false} hasDocument preferences={{ ...defaultAutocompletePreferences, manualOnly }} onPreferencesChange={noop}
      guidance={emptyWritingGuidance} onGuidanceChange={noop} snoozed={false} onToggleSnooze={noop} onResetShortcuts={noop} />
  );
}

describe("Writing assists menu", () => {
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
    expect(render(true)).toContain("Off: only when you press");
  });
});
