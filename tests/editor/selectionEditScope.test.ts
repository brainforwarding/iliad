import { describe, expect, it } from "vitest";
import {
  normalizeSelectionEditInstruction,
  selectionEditInstructionIsTooLong,
  selectionEditScopeForInstruction
} from "../../src/editor/selectionEditScope";

describe("selectionEditScopeForInstruction", () => {
  it("defaults ambiguous instructions to the selected span", () => {
    expect(selectionEditScopeForInstruction("make this clearer")).toBe("selection");
    expect(selectionEditScopeForInstruction("agrega el articulo que falta")).toBe("selection");
    expect(selectionEditScopeForInstruction("rewrite the sentence")).toBe("selection");
  });

  it("expands only for explicit whole-unit instructions", () => {
    expect(selectionEditScopeForInstruction("rewrite the whole paragraph")).toBe("safe_unit");
    expect(selectionEditScopeForInstruction("turn the whole bullet into one sentence")).toBe("safe_unit");
    expect(selectionEditScopeForInstruction("reescribe el párrafo")).toBe("safe_unit");
    expect(selectionEditScopeForInstruction("haz todo el bloque más directo")).toBe("safe_unit");
    expect(selectionEditScopeForInstruction("tabla completa en tono formal")).toBe("safe_unit");
  });
});

describe("selection edit instruction validation helpers", () => {
  it("trims the instruction and enforces the renderer-side cap", () => {
    expect(normalizeSelectionEditInstruction("  make this longer\n")).toBe("make this longer");
    expect(selectionEditInstructionIsTooLong("x".repeat(1000))).toBe(false);
    expect(selectionEditInstructionIsTooLong("x".repeat(1001))).toBe(true);
  });
});

