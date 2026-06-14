export type SelectionEditScope = "selection" | "safe_unit";

export const SELECTION_EDIT_INSTRUCTION_MAX_CHARS = 1000;

const BROAD_SCOPE_PATTERNS = [
  /\b(?:whole|entire|full)\s+(?:paragraph|para|bullet|list item|item|table|block)\b/i,
  /\brewrite\s+(?:the\s+)?(?:whole\s+|entire\s+|full\s+)?paragraph\b/i,
  /\b(?:todo|toda)\s+(?:el|la)?\s*(?:p[aá]rrafo|parrafo|viñeta|vineta|tabla|bloque)\b/i,
  /\b(?:p[aá]rrafo|parrafo|viñeta|vineta|tabla|bloque)\s+(?:completo|completa)\b/i,
  /\breescrib(?:e|ir)\s+(?:el\s+)?(?:p[aá]rrafo|parrafo)\b/i
];

export function normalizeSelectionEditInstruction(instruction: string): string {
  return instruction.trim();
}

export function selectionEditInstructionIsTooLong(instruction: string): boolean {
  return normalizeSelectionEditInstruction(instruction).length > SELECTION_EDIT_INSTRUCTION_MAX_CHARS;
}

export function selectionEditScopeForInstruction(instruction: string): SelectionEditScope {
  const normalized = normalizeSelectionEditInstruction(instruction);

  if (!normalized) {
    return "selection";
  }

  return BROAD_SCOPE_PATTERNS.some((pattern) => pattern.test(normalized)) ? "safe_unit" : "selection";
}

