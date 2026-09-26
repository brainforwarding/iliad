import { describe, expect, it } from "vitest";
import { placeTooltip } from "../../src/components/TooltipLayer";

const viewport = { width: 800, height: 600 };
const tip = { width: 190, height: 22 };

describe("placeTooltip", () => {
  it("centres below the anchor when there is room", () => {
    expect(placeTooltip({ left: 400, top: 10, width: 28, height: 28 }, tip, viewport)).toEqual({ left: 319, top: 44 });
  });

  it("keeps a long label inside the left edge", () => {
    expect(placeTooltip({ left: 20, top: 10, width: 28, height: 28 }, tip, viewport).left).toBe(8);
  });

  it("keeps it inside the right edge", () => {
    const { left } = placeTooltip({ left: 780, top: 10, width: 28, height: 28 }, tip, viewport);
    expect(left + tip.width).toBe(viewport.width - 8);
  });

  it("flips above when there is no room below", () => {
    expect(placeTooltip({ left: 400, top: 570, width: 28, height: 28 }, tip, viewport).top).toBe(570 - 6 - 22);
  });
});
