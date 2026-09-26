// Shared synthetic writing cases for the prompt snapshot tests and the Groq
// benchmark (scripts/benchmarkAutocomplete.ts). The eight EN/ES autocomplete
// cases carry over from the removed Gemini benchmark (`1de8393^`); its
// `inline` cases (automatic suggestions, removed) become `sentence`, the kind
// ⌘, sends. Synthetic text only: no writer's prose.

import type { AutocompleteTaskV1, SelectionTaskV1 } from "../../electron/writing/groq/prompts/index";

export interface AutocompleteCase {
  id: string;
  task: AutocompleteTaskV1;
}

export interface SelectionCase {
  id: string;
  task: SelectionTaskV1;
}

function autocomplete(
  id: string,
  language: "en" | "es",
  kind: AutocompleteTaskV1["kind"],
  prefix: string,
  suffix = "",
  extra: Partial<AutocompleteTaskV1> = {}
): AutocompleteCase {
  return {
    id,
    task: {
      v: 1,
      task: "autocomplete",
      language,
      kind,
      extend: false,
      prefix,
      suffix,
      documentTitle: "Synthetic benchmark",
      headingPath: [],
      nearbyHeadings: [],
      direction: "",
      avoid: [],
      ...extra
    }
  };
}

export const autocompleteCases: AutocompleteCase[] = [
  autocomplete("fiction-en", "en", "sentence", "Mara found the lighthouse door open. On the stairs she noticed "),
  autocomplete("fiction-es", "es", "sentence", "Mara encontró abierta la puerta del faro. En la escalera vio "),
  autocomplete("essay-en", "en", "paragraph", "An effective classroom gives students time to revise their thinking. For example, "),
  autocomplete("essay-es", "es", "paragraph", "Una buena clase permite que los estudiantes revisen sus ideas. Por ejemplo, "),
  autocomplete("dialogue-en", "en", "sentence", "“You knew,” she said.\n\n“I knew only that ", ",” he replied."),
  autocomplete("dialogue-es", "es", "sentence", "—Tú lo sabías.\n\n—Solo sabía que ", " —respondió él."),
  autocomplete("middle-en", "en", "sentence", "The simplest way to improve a draft is to ", " before sharing it with a reader."),
  autocomplete("middle-es", "es", "sentence", "La forma más sencilla de mejorar un borrador es ", " antes de compartirlo con otra persona."),
  autocomplete(
    "idea-es",
    "es",
    "idea",
    "## Actividad: escucha en parejas\n\n1. Formen parejas.\n2. Una persona cuenta durante dos minutos qué aprendió esta semana.\n3. ",
    "",
    { documentTitle: "Taller de escritura", headingPath: ["Taller de escritura", "Actividad: escucha en parejas"], nearbyHeadings: ["Cierre"] }
  )
];

function selection(id: string, language: "en" | "es", mode: SelectionTaskV1["mode"], before: string, selected: string, after: string, instruction?: string): SelectionCase {
  const text = `${before}${selected}${after}`;
  return {
    id,
    task: {
      v: 1,
      task: "selection",
      language,
      mode,
      ...(instruction ? { instruction } : {}),
      text,
      selection: { from: before.length, to: before.length + selected.length }
    }
  };
}

export const selectionCases: SelectionCase[] = [
  selection(
    "tighten-en",
    "en",
    "tighten",
    "Our team met on Monday. ",
    "At this point in time, it is really quite important that we all take the necessary steps in order to make sure that the report is finished before the deadline actually arrives.",
    " Maya will send the draft."
  ),
  selection(
    "tighten-es",
    "es",
    "tighten",
    "El equipo se reunió el lunes. ",
    "En este preciso momento es realmente muy importante que todos nosotros tomemos las medidas que sean necesarias con el fin de asegurarnos de que el informe quede terminado antes de que llegue la fecha límite.",
    " Maya enviará el borrador."
  ),
  selection(
    "edit-en",
    "en",
    "edit",
    "",
    "The meeting is moved to Thursday. Bring the budget numbers.",
    "\n\nThanks,\nAna",
    "Make it warmer and friendlier."
  ),
  selection(
    "edit-es",
    "es",
    "edit",
    "",
    "La reunión se mueve al jueves. Traigan las cifras del presupuesto.",
    "\n\nGracias,\nAna",
    "Hazlo más cálido y cercano."
  )
];

// ---------------------------------------------------------------------------
// Adversarial Unicode for the budget probe (billed prompt tokens vs UTF-8
// bytes). Deterministic (seeded) so runs are comparable.

export type AdversarialFlavor = "cjk" | "cjk-ext-b" | "emoji-zwj" | "combining" | "rtl" | "random";

export const ADVERSARIAL_FLAVORS: AdversarialFlavor[] = ["cjk", "cjk-ext-b", "emoji-zwj", "combining", "rtl", "random"];

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EMOJI_BASES = [0x1f468, 0x1f469, 0x1f9d1, 0x1f3f3, 0x1f441, 0x1f408, 0x1f43b, 0x1f469];
const COMBINING = [0x0301, 0x0300, 0x0308, 0x0303, 0x0327, 0x0336, 0x035c, 0x0361, 0x20dd, 0x1dc4];
const RTL_RANGES: Array<[number, number]> = [[0x05d0, 0x05ea], [0x0627, 0x064a], [0x0660, 0x0669]];
const BIDI_CONTROLS = [0x200f, 0x202b, 0x202e, 0x2067, 0x2069, 0x061c];

/** Exactly `maxChars` UTF-16 code units (never a split surrogate pair) of the given flavor. */
export function adversarialText(flavor: AdversarialFlavor, maxChars: number, seed = 1): string {
  const rand = mulberry32(seed * 7919 + flavor.length * 104729);
  const pick = <T,>(items: T[]) => items[Math.floor(rand() * items.length)];
  const range = (from: number, to: number) => from + Math.floor(rand() * (to - from + 1));
  let out = "";

  const next = (): string => {
    switch (flavor) {
      case "cjk":
        // Rarer BMP CJK (3 UTF-8 bytes, 1 UTF-16 unit) — worst bytes per unit.
        return String.fromCodePoint(range(0x4e00, 0x9fff));
      case "cjk-ext-b":
        return String.fromCodePoint(range(0x20000, 0x2a6df));
      case "emoji-zwj": {
        const skin = rand() < 0.5 ? String.fromCodePoint(range(0x1f3fb, 0x1f3ff)) : "";
        return `${String.fromCodePoint(pick(EMOJI_BASES))}${skin}‍${String.fromCodePoint(pick(EMOJI_BASES))}️`;
      }
      case "combining": {
        let cluster = String.fromCodePoint(range(0x61, 0x7a));
        const marks = range(1, 6);
        for (let index = 0; index < marks; index += 1) cluster += String.fromCodePoint(pick(COMBINING));
        return cluster;
      }
      case "rtl": {
        const [from, to] = pick(RTL_RANGES);
        return rand() < 0.15 ? String.fromCodePoint(pick(BIDI_CONTROLS)) : rand() < 0.1 ? " " : String.fromCodePoint(range(from, to));
      }
      case "random": {
        // Any assigned-or-not scalar value outside surrogates and controls.
        let code = 0;
        do code = range(0x20, 0x10ffff);
        while ((code >= 0xd800 && code <= 0xdfff) || (code >= 0x7f && code <= 0x9f));
        return String.fromCodePoint(code);
      }
    }
  };

  while (out.length < maxChars) {
    const piece = next();
    if (out.length + piece.length > maxChars) {
      // Fill the remainder with a 1-unit, 3-byte character so the field is exactly at its limit.
      out += "界".repeat(maxChars - out.length);
      break;
    }
    out += piece;
  }

  return out;
}
