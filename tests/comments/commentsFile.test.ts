import { describe, expect, it } from "vitest";
import { parseCommentsFile, serializeCommentsFile, type CommentsFileEntry } from "../../src/comments/commentsFile";

function roundTrip(entries: CommentsFileEntry[]) {
  const text = serializeCommentsFile(entries);
  expect(parseCommentsFile(text)).toEqual(entries);
  // Serializing the parsed entries again is stable.
  expect(serializeCommentsFile(parseCommentsFile(text))).toBe(text);
  return text;
}

describe("comments file format", () => {
  it("writes entries separated by a blank line, ---, and a blank line", () => {
    const text = roundTrip([
      { id: "c1", quote: "Durante dos minutos, una persona cuenta un desafío reciente.", comment: "Esto es muy largo." },
      { id: "c2", quote: "Al terminar, cada pareja comparte una frase", comment: "¿Una frase o una idea? Aclarar." }
    ]);

    expect(text).toBe(
      [
        "<!-- iliad:comment id=c1 -->",
        "> Durante dos minutos, una persona cuenta un desafío reciente.",
        "",
        "Esto es muy largo.",
        "",
        "---",
        "",
        "<!-- iliad:comment id=c2 -->",
        "> Al terminar, cada pareja comparte una frase",
        "",
        "¿Una frase o una idea? Aclarar.",
        ""
      ].join("\n")
    );
  });

  it("round-trips multi-line quotes, including blank quoted lines", () => {
    const text = roundTrip([{ id: "m", quote: "First line\n\n  indented second\nthird", comment: "Line one\n\nLine three" }]);
    expect(text).toContain("> First line\n>\n>   indented second\n> third\n");
  });

  it("escapes comment lines that would read as separators, quotes, or metadata", () => {
    const comment = "---\n> not a quote\n\\---\n\\> already escaped\n<!-- iliad:comment id=x -->\nplain";
    const text = roundTrip([{ id: "e", quote: "q", comment }]);

    expect(text).toContain("\n\\---\n");
    expect(text).toContain("\n\\> not a quote\n");
    expect(text).toContain("\n\\\\---\n");
    expect(text).toContain("\n\\<!-- iliad:comment id=x -->\n");
    expect(parseCommentsFile(text)).toHaveLength(1);
  });

  it("writes occurrence and prefix only when given, and keeps odd prefixes intact", () => {
    const text = roundTrip([
      { id: "d1", quote: "video", comment: "first", occurrence: 2, prefix: 'said "hi" -- then\nnext ' },
      { id: "d2", quote: "unique", comment: "second" }
    ]);

    expect(text).toContain("<!-- iliad:comment id=d1 occurrence=2 prefix=");
    expect(text).not.toMatch(/prefix="[^\n]*--[^\n]*-->/);
    expect(text).toContain("<!-- iliad:comment id=d2 -->");
  });

  it("keeps text it does not recognise as comment text with an empty quote", () => {
    const entries = parseCommentsFile("A note an agent left at the top.\n\n---\n\n> quoted\n\nhand-written comment\n");

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ quote: "", comment: "A note an agent left at the top." });
    expect(entries[1]).toMatchObject({ quote: "quoted", comment: "hand-written comment" });
    // Ids for entries without metadata are stable across reads.
    expect(parseCommentsFile("> quoted\n\nhand-written comment\n")[0].id).toBe(entries[1].id);
    roundTrip(entries);
  });

  it("parses entries whose separator is missing and ignores blank blocks", () => {
    const entries = parseCommentsFile(
      "<!-- iliad:comment id=a -->\n> one\n\nfirst\n<!-- iliad:comment id=b -->\n> two\n\nsecond\n\n---\n\n---\n"
    );

    expect(entries.map((entry) => [entry.id, entry.quote, entry.comment])).toEqual([
      ["a", "one", "first"],
      ["b", "two", "second"]
    ]);
  });

  it("keeps ids unique and handles CRLF files", () => {
    const entries = parseCommentsFile("<!-- iliad:comment id=a -->\r\n> x\r\n\r\none\r\n\r\n---\r\n\r\n<!-- iliad:comment id=a -->\r\n> y\r\n\r\ntwo\r\n");

    expect(entries.map((entry) => entry.id)).toEqual(["a", "a-2"]);
    expect(entries[1].comment).toBe("two");
  });

  it("serializes an empty list as an empty file", () => {
    expect(serializeCommentsFile([])).toBe("");
    expect(parseCommentsFile("")).toEqual([]);
  });
});
