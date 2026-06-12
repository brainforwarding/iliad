import { describe, expect, it } from "vitest";
import {
  findInlineCodeRanges,
  findLatexInlineMath,
  isDisplayLatexCloseLine,
  isDisplayLatexOpenLine,
  latexMathToDollar,
  matchOneLineDisplayLatex
} from "../../src/markdown/mathDelimiters";

describe("findLatexInlineMath", () => {
  it("matches a simple inline \\( … \\) and trims the TeX", () => {
    const [range, ...rest] = findLatexInlineMath("angle \\( \\theta \\) here");
    expect(rest).toHaveLength(0);
    expect(range).toMatchObject({ kind: "inline", tex: "\\theta" });
    expect("angle \\( \\theta \\) here".slice(range.from, range.to)).toBe("\\( \\theta \\)");
  });

  it("ignores an escaped opener \\\\(", () => {
    expect(findLatexInlineMath("literal \\\\(x\\\\) text")).toHaveLength(0);
  });

  it("requires a closer on the same line", () => {
    expect(findLatexInlineMath("opens \\( x but never closes")).toHaveLength(0);
    expect(findLatexInlineMath("a \\( x \\)\nb \\( y")).toHaveLength(1);
  });

  it("requires non-empty inner content", () => {
    expect(findLatexInlineMath("empty \\(  \\) here")).toHaveLength(0);
  });

  it("does not match inside inline code spans", () => {
    const line = "code `\\( x \\)` and math \\( y \\)";
    const ranges = findLatexInlineMath(line, findInlineCodeRanges(line));
    expect(ranges).toHaveLength(1);
    expect(ranges[0].tex).toBe("y");
  });

  it("handles variable-length backtick code spans", () => {
    const line = "``a `\\(z\\)` b`` then \\( w \\)";
    const ranges = findLatexInlineMath(line, findInlineCodeRanges(line));
    expect(ranges.map((range) => range.tex)).toEqual(["w"]);
  });
});

describe("display \\[ … \\]", () => {
  it("matches a one-line display block", () => {
    expect(matchOneLineDisplayLatex("\\[ x^2 + y^2 \\]")).toBe("x^2 + y^2");
  });

  it("does not treat inline \\[ … \\] in prose as display", () => {
    expect(matchOneLineDisplayLatex("before \\[ x \\] after")).toBeNull();
  });

  it("recognizes standalone opener/closer lines", () => {
    expect(isDisplayLatexOpenLine("  \\[")).toBe(true);
    expect(isDisplayLatexCloseLine("\\]  ")).toBe(true);
    expect(isDisplayLatexOpenLine("\\[ x")).toBe(false);
  });
});

describe("latexMathToDollar (preview rewrite)", () => {
  it("rewrites inline and one-line display, leaving code untouched", () => {
    const input = ["See \\( \\theta \\) and:", "\\[ a^2 \\]", "`keep \\( raw \\)`"].join("\n");
    expect(latexMathToDollar(input)).toBe(["See $\\theta$ and:", "$$a^2$$", "`keep \\( raw \\)`"].join("\n"));
  });

  it("never rewrites inside fenced code", () => {
    const input = ["```", "\\( x \\)", "$$y$$", "```", "\\( z \\)"].join("\n");
    expect(latexMathToDollar(input)).toBe(["```", "\\( x \\)", "$$y$$", "```", "$z$"].join("\n"));
  });

  it("leaves existing dollar math alone", () => {
    expect(latexMathToDollar("inline $a$ and $$b$$")).toBe("inline $a$ and $$b$$");
  });
});
