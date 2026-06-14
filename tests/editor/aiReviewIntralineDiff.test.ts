import { describe, expect, it } from "vitest";
import { intralineTokenDiff } from "../../src/editor/aiReview/intralineDiff";

describe("intralineTokenDiff", () => {
  it("marks only inserted words for a pure insertion", () => {
    const oldText = '* ¿Qué principios serán "línea roja" (privacidad, transparencia, no reemplazar aprendizaje, equidad)?';
    const newText =
      '* ¿Qué principios serán "línea roja" (privacidad, transparencia, no reemplazar el aprendizaje, equidad)?';

    expect(intralineTokenDiff(oldText, newText)).toEqual({
      oldRanges: [],
      newRanges: [{ from: newText.indexOf("el aprendizaje"), to: newText.indexOf("aprendizaje") }]
    });
  });

  it("marks both sides for a replacement", () => {
    const oldText = "You write best when the tool stays quiet and out of your way.";
    const newText = "You write best when the tool disappears under your eye.";

    const diff = intralineTokenDiff(oldText, newText);
    const oldChanged = diff.oldRanges.map((range) => oldText.slice(range.from, range.to)).join("");
    const newChanged = diff.newRanges.map((range) => newText.slice(range.from, range.to)).join("");

    expect(oldChanged).toContain("stays quiet");
    expect(oldChanged).toContain("way");
    expect(newChanged).toContain("disappears");
    expect(newChanged).toContain("eye");
  });
});
