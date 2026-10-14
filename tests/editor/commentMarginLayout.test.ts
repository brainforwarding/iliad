import { describe, expect, it } from "vitest";
import { commentMarginFits, layoutMarginNotes, type MarginNoteInput } from "../../src/editor/commentMargin/layout";

const note = (id: string, anchorTop: number, lines: number, from = anchorTop): MarginNoteInput => ({ id, anchorTop, from, lines });

describe("comment margin layout", () => {
  it("returns nothing for no comments", () => {
    expect(layoutMarginNotes([])).toEqual([]);
  });

  it("shows every note in full beside its passage when there is room", () => {
    expect(layoutMarginNotes([note("a", 100, 2), note("b", 300, 3)])).toEqual([
      { id: "a", top: 100, lines: 2, folded: [] },
      { id: "b", top: 300, lines: 3, folded: [] }
    ]);
  });

  it("pushes a note down below the previous one, within the tolerance", () => {
    const [, b] = layoutMarginNotes([note("a", 100, 2), note("b", 120, 1)]);
    // a ends at 136; b starts 6 px later.
    expect(b).toEqual({ id: "b", top: 142, lines: 1, folded: [] });
  });

  it("cuts a note to the lines that keep the next one within the tolerance", () => {
    const [a] = layoutMarginNotes([note("a", 100, 6), note("b", 130, 1)]);
    // Room: (130 + 45 - 100 - 6) / 18 = 3.8 → 3 lines.
    expect(a.lines).toBe(3);
  });

  it("never cuts a note below one line", () => {
    const tight = { lineHeight: 18, gap: 6, tolerance: 0, moreRowHeight: 20 };
    const [a] = layoutMarginNotes([note("a", 100, 4), note("b", 100, 1, 101)], tight);
    expect(a.lines).toBe(1);
  });

  it("never cuts the last note", () => {
    const placements = layoutMarginNotes([note("a", 100, 1), note("b", 130, 9)]);
    expect(placements[1].lines).toBe(9);
  });

  it("folds notes that would land too far below their passage into +N more", () => {
    const placements = layoutMarginNotes([note("a", 100, 1, 1), note("b", 100, 1, 2), note("c", 100, 1, 3), note("d", 100, 1, 4)]);
    // a 100–118, b 124–142; c would start at 148 (48 below its passage): c and d fold into b.
    expect(placements.map((placement) => [placement.id, placement.top, placement.folded])).toEqual([
      ["a", 100, []],
      ["b", 124, ["c", "d"]]
    ]);
  });

  it("counts the +N more row before placing the next note", () => {
    const placements = layoutMarginNotes([
      note("a", 100, 1, 1),
      note("b", 100, 1, 2),
      note("c", 100, 1, 3),
      note("d", 100, 1, 4),
      note("e", 200, 1)
    ]);
    // b 124–142 plus a 20 px "+2 more" row ends at 162; e at its anchor 200.
    expect(placements.at(-1)).toEqual({ id: "e", top: 200, lines: 1, folded: [] });
  });

  it("orders notes on the same line by document position", () => {
    const placements = layoutMarginNotes([note("later", 100, 1, 50), note("earlier", 100, 1, 10)]);
    expect(placements.map((placement) => placement.id)).toEqual(["earlier", "later"]);
  });

  it("keeps folding local so later passages are back in line", () => {
    const busy = [1, 2, 3, 4, 5, 6].map((index) => note(`n${index}`, 100, 2, index));
    const placements = layoutMarginNotes([...busy, note("far", 600, 2)]);
    expect(placements.at(-1)).toEqual({ id: "far", top: 600, lines: 2, folded: [] });
    expect(placements.flatMap((placement) => placement.folded).length).toBeGreaterThan(0);
  });

  it("lays out in document order and never lets an estimate jump above an earlier passage", () => {
    // "late" is off screen in a long wrapped paragraph: its estimate is the paragraph top (80).
    const placements = layoutMarginNotes([note("early", 300, 1, 10), note("late", 80, 1, 500)]);
    expect(placements.map((placement) => [placement.id, placement.top])).toEqual([
      ["early", 300],
      ["late", 324]
    ]);
  });

  it("knows when the editor is too narrow for the margin", () => {
    expect(commentMarginFits(1200)).toBe(true);
    expect(commentMarginFits(780)).toBe(true);
    expect(commentMarginFits(779)).toBe(false);
    expect(commentMarginFits(Number.NaN)).toBe(false);
  });
});
