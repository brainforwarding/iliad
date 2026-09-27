import { describe, expect, it } from "vitest";
import {
  detectFolderNamingStyle,
  documentStem,
  fileNameFromRenameInput,
  formatDocumentStem,
  hasEnoughTextToName,
  headingDocumentName,
  maxDocumentStemLength,
  namingInputText,
  planDocumentName,
  siblingDocumentNames
} from "../../src/files/documentNaming";
import type { FileTreeNode } from "../../src/types/iliad";

const prose = "Esta es una frase de prueba con bastante texto para contar como prosa real. ".repeat(4);

describe("headingDocumentName", () => {
  it("takes the first non-empty line when it is an ATX heading", () => {
    expect(headingDocumentName("\n\n# Plan de sesión\n\nTexto")).toBe("Plan de sesión");
    expect(headingDocumentName("## Weekly notes\nBody")).toBe("Weekly notes");
    expect(headingDocumentName("   ### Indented up to three\n")).toBe("Indented up to three");
  });

  it("strips the closing #s", () => {
    expect(headingDocumentName("# Hola #")).toBe("Hola");
    expect(headingDocumentName("# Hola ###   ")).toBe("Hola");
    expect(headingDocumentName("# C# notes")).toBe("C# notes");
  });

  it("strips simple inline Markdown", () => {
    expect(headingDocumentName("# **Bold** and _soft_ `code`")).toBe("Bold and soft code");
    expect(headingDocumentName("# See [the plan](plan.md) now")).toBe("See the plan now");
    expect(headingDocumentName("# ~~Old~~ new")).toBe("Old new");
  });

  it("ignores text that is not a heading first", () => {
    expect(headingDocumentName("Intro line\n# Heading later")).toBeNull();
    expect(headingDocumentName("#hashtag is not a heading")).toBeNull();
    expect(headingDocumentName("    # four spaces is code")).toBeNull();
    expect(headingDocumentName("")).toBeNull();
  });

  it("never reads a heading inside a fence", () => {
    expect(headingDocumentName("```\n# not a heading\n```\n# Later")).toBeNull();
    expect(headingDocumentName("~~~md\n# inside\n~~~")).toBeNull();
  });

  it("returns null for empty or emoji/symbol-only headings", () => {
    expect(headingDocumentName("#")).toBeNull();
    expect(headingDocumentName("# ###")).toBeNull();
    expect(headingDocumentName("# 🎉🎉")).toBeNull();
    expect(headingDocumentName("# — * —")).toBeNull();
    expect(headingDocumentName("# 🎉 Fiesta")).toBe("🎉 Fiesta");
  });
});

describe("hasEnoughTextToName", () => {
  it("accepts a finished first-line heading", () => {
    expect(hasEnoughTextToName("# Plan de sesión\n")).toBe(true);
    expect(hasEnoughTextToName("# Plan de sesión\n\nUna línea")).toBe(true);
  });

  it("waits while the heading is still being typed", () => {
    expect(hasEnoughTextToName("# Plan de")).toBe(false);
    expect(hasEnoughTextToName("# 🎉\n")).toBe(false);
  });

  it("needs ~200 characters of prose otherwise, not counting the heading", () => {
    expect(hasEnoughTextToName("short text")).toBe(false);
    expect(hasEnoughTextToName(prose)).toBe(true);
    expect(hasEnoughTextToName("x".repeat(199))).toBe(false);
    expect(hasEnoughTextToName("x".repeat(200))).toBe(true);
    expect(hasEnoughTextToName("   \n\n  ")).toBe(false);
  });
});

describe("planDocumentName", () => {
  it("uses the heading without AI, else the opening text for the AI", () => {
    expect(planDocumentName("# Weekly review\nBody")).toEqual({ source: "heading", title: "Weekly review" });
    expect(planDocumentName(prose)).toEqual({ source: "ai", text: prose });
    expect(planDocumentName("tiny")).toBeNull();
  });

  it("falls back to the AI when the heading gives no name but there is enough prose", () => {
    expect(planDocumentName(`# 🎉\n${prose}`)?.source).toBe("ai");
  });

  it("sends at most ~1,500 characters (whole code points)", () => {
    const long = "ñ🎉".repeat(1000);
    const input = namingInputText(long);
    expect([...input]).toHaveLength(1500);
    expect(input.endsWith("\ud83c")).toBe(false);
  });
});

describe("detectFolderNamingStyle", () => {
  it("defaults to kebab without siblings or on a tie", () => {
    expect(detectFolderNamingStyle([])).toBe("kebab");
    expect(detectFolderNamingStyle(["plan-a.md", "Plan B.md"])).toBe("kebab");
  });

  it("chooses spaced only with strictly more spaced files", () => {
    expect(detectFolderNamingStyle(["Plan A.md", "Plan B.md", "plan-c.md"])).toBe("spaced");
    expect(detectFolderNamingStyle(["Plan A.md", "notes.md"])).toBe("kebab");
  });

  it("ignores companions, non-Markdown files and other shapes", () => {
    expect(detectFolderNamingStyle(["My Doc.comments.md", "Other Doc.comments.md", "a.md"])).toBe("kebab");
    expect(detectFolderNamingStyle(["Photo One.png", "Photo Two.png"])).toBe("kebab");
    expect(detectFolderNamingStyle(["CamelCase.md", "Snake_case.md", "Two Words.md"])).toBe("spaced");
  });
});

describe("siblingDocumentNames", () => {
  const tree: FileTreeNode[] = [
    { name: "Root Doc.md", path: "/ws/Root Doc.md", relativePath: "Root Doc.md", kind: "markdown" },
    {
      name: "drafts",
      path: "/ws/drafts",
      relativePath: "drafts",
      kind: "directory",
      children: [
        { name: "untitled.md", path: "/ws/drafts/untitled.md", relativePath: "drafts/untitled.md", kind: "markdown" },
        { name: "one-two.md", path: "/ws/drafts/one-two.md", relativePath: "drafts/one-two.md", kind: "markdown" },
        {
          name: "one-two.comments.md",
          path: "/ws/drafts/one-two.comments.md",
          relativePath: "drafts/one-two.comments.md",
          kind: "markdown",
          companion: { kind: "comments", documentPath: "/ws/drafts/one-two.md" }
        },
        { name: "image.png", path: "/ws/drafts/image.png", relativePath: "drafts/image.png", kind: "external" }
      ]
    }
  ];

  it("lists immediate sibling documents, excluding itself and companions", () => {
    expect(siblingDocumentNames(tree, "/ws", "/ws/drafts/untitled.md")).toEqual(["one-two.md"]);
    expect(siblingDocumentNames(tree, "/ws", "/ws/untitled.md")).toEqual(["Root Doc.md"]);
  });
});

describe("formatDocumentStem", () => {
  it("formats kebab-case: accents stripped, lowercase, letters and digits", () => {
    expect(formatDocumentStem("Plan de sesión", "kebab")).toBe("plan-de-sesion");
    expect(formatDocumentStem("Año nuevo, ¡niños!", "kebab")).toBe("ano-nuevo-ninos");
    expect(formatDocumentStem("Q3 2026: Roadmap / Draft", "kebab")).toBe("q3-2026-roadmap-draft");
    expect(formatDocumentStem("  🎉 Party   time 🎉 ", "kebab")).toBe("party-time");
  });

  it("formats spaced: keeps capitals and accents, drops punctuation", () => {
    expect(formatDocumentStem("Plan de sesión", "spaced")).toBe("Plan de sesión");
    expect(formatDocumentStem("Año nuevo: ¡niños!", "spaced")).toBe("Año nuevo niños");
    expect(formatDocumentStem("../etc/passwd", "spaced")).toBe("etc passwd");
    expect(formatDocumentStem(".hidden name", "spaced")).toBe("hidden name");
  });

  it("normalizes to NFC and removes control and invisible characters", () => {
    const decomposed = "Sesión";
    expect(formatDocumentStem(decomposed, "spaced")).toBe("Sesión");
    expect(formatDocumentStem(decomposed, "spaced")?.length).toBe(6);
    expect(formatDocumentStem("Tab\there\u0000now​!", "kebab")).toBe("tab-here-now");
  });

  it("never produces path separators, dots or companion shapes", () => {
    for (const title of ["a/b\\c", "notes.comments.md", "..", "x.md", "name.comments"]) {
      for (const style of ["kebab", "spaced"] as const) {
        const stem = formatDocumentStem(title, style);
        expect(stem === null || !/[./\\]/.test(stem)).toBe(true);
      }
    }
  });

  it("returns null when nothing usable is left", () => {
    expect(formatDocumentStem("", "kebab")).toBeNull();
    expect(formatDocumentStem("🎉🎉", "kebab")).toBeNull();
    expect(formatDocumentStem("!!! ??? ...", "spaced")).toBeNull();
    expect(formatDocumentStem("Привет мир", "kebab")).toBeNull();
    expect(formatDocumentStem("Привет мир", "spaced")).toBe("Привет мир");
  });

  it("cuts long titles at a word boundary within 60 characters", () => {
    const title = "The quick brown fox jumps over the lazy dog and keeps running far away";
    const kebab = formatDocumentStem(title, "kebab") as string;
    const spaced = formatDocumentStem(title, "spaced") as string;
    expect(kebab.length).toBeLessThanOrEqual(maxDocumentStemLength);
    expect(kebab).toBe("the-quick-brown-fox-jumps-over-the-lazy-dog-and-keeps");
    expect(spaced).toBe("The quick brown fox jumps over the lazy dog and keeps");
    expect(kebab.endsWith("-")).toBe(false);
  });

  it("cuts a very long unbroken word at 60 characters", () => {
    const word = "Supercalifragilisticoespialidoso".repeat(3);
    expect(formatDocumentStem(word, "kebab")).toBe(word.toLowerCase().slice(0, 60));
    expect(formatDocumentStem(`Hi ${"ñ".repeat(80)}`, "spaced")).toBe(`Hi ${"ñ".repeat(57)}`);
  });
});

describe("rename input helpers", () => {
  it("adds .md to a document name and keeps other files as typed", () => {
    expect(fileNameFromRenameInput({ kind: "markdown" }, " Plan ")).toBe("Plan.md");
    expect(fileNameFromRenameInput({ kind: "markdown" }, "plan.markdown")).toBe("plan.md");
    expect(fileNameFromRenameInput({ kind: "external" }, "photo.png")).toBe("photo.png");
    expect(fileNameFromRenameInput({ kind: "markdown" }, "   ")).toBe("");
  });

  it("reads a document stem", () => {
    expect(documentStem("/ws/drafts/untitled-2.md")).toBe("untitled-2");
    expect(documentStem("Plan de sesión.markdown")).toBe("Plan de sesión");
  });
});
