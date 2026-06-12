import { describe, expect, it } from "vitest";
import {
  applyAnchoredEdits,
  parseAnchoredEditBlocks,
  parseLegacyProposalDrafts,
  parseProposalDrafts,
  sanitizeLegacyAssistantText
} from "../../electron/agent/proposalDrafts";
import type { AgentRunRequest } from "../../electron/agent/types";

function runRequest(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    runId: "run-proposal-drafts-test",
    workspaceRoot: "/workspace",
    activeFile: {
      path: "/workspace/doc.md",
      relativePath: "doc.md",
      content: "# Title\n\nalpha line\n\nclosing line\n",
      baseHash: "base-hash",
    },
    messages: [],
    prompt: "Fix the typo.",
    mode: "balanced",
    language: "en",
    ...overrides
  };
}

function anchoredBlock(search: string, replace: string) {
  return ["<<<<<<< SEARCH", search, "=======", replace, ">>>>>>> REPLACE"].join("\n");
}

describe("parseAnchoredEditBlocks", () => {
  it("parses a single block into one (search, replace) split", () => {
    const blocks = parseAnchoredEditBlocks(anchoredBlock("old text", "new text"));

    expect(blocks).toHaveLength(1);
    expect(blocks[0].splits).toEqual([{ search: "old text", replace: "new text" }]);
  });

  it("parses multiple blocks in document order with case-insensitive markers", () => {
    const text = [
      "Prose before.",
      "<<<<<<< search",
      "first",
      "=======",
      "FIRST",
      ">>>>>>> replace",
      "Prose between.",
      anchoredBlock("second", "SECOND")
    ].join("\n");
    const blocks = parseAnchoredEditBlocks(text);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].splits).toEqual([{ search: "first", replace: "FIRST" }]);
    expect(blocks[1].splits).toEqual([{ search: "second", replace: "SECOND" }]);
    expect(blocks[0].start).toBeLessThan(blocks[1].start);
  });

  it("keeps ``` fences and non-anchored ======= prose inside bodies", () => {
    const search = ["```js", "const a = 1;", "```", "x ======= y", " ======="].join("\n");
    const blocks = parseAnchoredEditBlocks(anchoredBlock(search, "replacement"));

    expect(blocks).toHaveLength(1);
    expect(blocks[0].splits).toEqual([{ search, replace: "replacement" }]);
  });

  it("collects every setext-style ======= line as a candidate split", () => {
    const text = ["<<<<<<< SEARCH", "Heading", "=======", "Old body", "=======", "New body", ">>>>>>> REPLACE"].join("\n");
    const blocks = parseAnchoredEditBlocks(text);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].splits).toEqual([
      { search: "Heading", replace: "Old body\n=======\nNew body" },
      { search: "Heading\n=======\nOld body", replace: "New body" }
    ]);
  });

  it("still parses marker lines wrapped in a prose code fence (markers are line-anchored and reserved)", () => {
    const text = ["Explanation.", "```", anchoredBlock("old", "new"), "```"].join("\n");

    expect(parseAnchoredEditBlocks(text)).toHaveLength(1);
  });

  it("fails the whole parse closed on malformed structure", () => {
    const unterminated = ["<<<<<<< SEARCH", "old", "=======", "new"].join("\n");
    const missingDivider = ["<<<<<<< SEARCH", "old", ">>>>>>> REPLACE"].join("\n");
    const emptySearch = ["<<<<<<< SEARCH", "=======", "new", ">>>>>>> REPLACE"].join("\n");
    const validThenBroken = [anchoredBlock("old", "new"), "<<<<<<< SEARCH", "tail"].join("\n");

    expect(parseAnchoredEditBlocks(unterminated)).toEqual([]);
    expect(parseAnchoredEditBlocks(missingDivider)).toEqual([]);
    expect(parseAnchoredEditBlocks(emptySearch)).toEqual([]);
    expect(parseAnchoredEditBlocks(validThenBroken)).toEqual([]);
  });
});

describe("applyAnchoredEdits", () => {
  it("replaces a uniquely matched SEARCH", () => {
    const result = applyAnchoredEdits("keep\nalpha line\nkeep\n", parseAnchoredEditBlocks(anchoredBlock("alpha line", "beta line")));

    expect(result).toEqual({ ok: true, replacement: "keep\nbeta line\nkeep\n" });
  });

  it("applies blocks sequentially: later SEARCH matches text created by earlier blocks", () => {
    const blocks = parseAnchoredEditBlocks([anchoredBlock("alpha", "beta"), anchoredBlock("beta two", "gamma")].join("\n"));
    const result = applyAnchoredEdits("alpha two", blocks);

    expect(result).toEqual({ ok: true, replacement: "gamma" });
  });

  it("fails closed with not_found and the failing block index", () => {
    const blocks = parseAnchoredEditBlocks([anchoredBlock("alpha", "beta"), anchoredBlock("missing", "x")].join("\n"));

    expect(applyAnchoredEdits("alpha\n", blocks)).toEqual({ ok: false, reason: "not_found", blockIndex: 1 });
  });

  it("fails closed with ambiguous when SEARCH matches more than once", () => {
    const blocks = parseAnchoredEditBlocks(anchoredBlock("twice", "once"));

    expect(applyAnchoredEdits("twice and twice\n", blocks)).toEqual({ ok: false, reason: "ambiguous", blockIndex: 0 });
  });

  it("resolves a setext collision when exactly one candidate split is viable", () => {
    const text = ["<<<<<<< SEARCH", "Heading", "=======", "Old body", "=======", "New body", ">>>>>>> REPLACE"].join("\n");
    // "Heading" alone matches twice, so only the setext-spanning split is viable.
    const result = applyAnchoredEdits("Heading\n=======\nOld body\nHeading mention\n", parseAnchoredEditBlocks(text));

    expect(result).toEqual({ ok: true, replacement: "New body\nHeading mention\n" });
  });

  it("fails closed when several setext candidate splits are viable", () => {
    const text = ["<<<<<<< SEARCH", "Heading", "=======", "Old body", "=======", "New body", ">>>>>>> REPLACE"].join("\n");
    // Both "Heading" and "Heading\n=======\nOld body" match exactly once.
    const result = applyAnchoredEdits("Heading\n=======\nOld body\n", parseAnchoredEditBlocks(text));

    expect(result).toEqual({ ok: false, reason: "ambiguous", blockIndex: 0 });
  });

  it("accepts a whole-file SEARCH and an empty REPLACE deletion", () => {
    const wholeFile = applyAnchoredEdits("entire document\n", parseAnchoredEditBlocks(anchoredBlock("entire document\n", "rewritten\n")));
    const deletion = applyAnchoredEdits("keep delete me keep", parseAnchoredEditBlocks(anchoredBlock(" delete me", "")));

    expect(wholeFile).toEqual({ ok: true, replacement: "rewritten\n" });
    expect(deletion).toEqual({ ok: true, replacement: "keep keep" });
  });
});

describe("parseProposalDrafts (anchored transport)", () => {
  it("turns a successful anchored edit into an edit_file draft with untouched regions byte-identical", () => {
    const request = runRequest();
    const text = ["I prepared a proposal. Review it in the document.", anchoredBlock("alpha line", "beta line")].join("\n");
    const parsed = parseProposalDrafts(request, text);

    expect(parsed.anchoredEditFailed).toBe(false);
    expect(parsed.drafts).toHaveLength(1);
    expect(parsed.drafts[0]).toMatchObject({
      kind: "edit_file",
      relativePath: "doc.md",
      baseHash: "base-hash",
      baseContent: request.activeFile?.content,
      replacement: "# Title\n\nbeta line\n\nclosing line\n",
      summary: "I prepared a proposal. Review it in the document."
    });
    expect(parsed.drafts[0].replacement?.startsWith("# Title\n\n")).toBe(true);
    expect(parsed.drafts[0].replacement?.endsWith("\n\nclosing line\n")).toBe(true);
    expect(parsed.drafts[0].unifiedDiff).toBeTruthy();
  });

  it("normalizes CRLF model output before parsing", () => {
    const text = ["Listo.", anchoredBlock("alpha line", "beta line")].join("\n").replace(/\n/g, "\r\n");
    const parsed = parseProposalDrafts(runRequest(), text);

    expect(parsed.drafts).toHaveLength(1);
    expect(parsed.drafts[0].replacement).toBe("# Title\n\nbeta line\n\nclosing line\n");
  });

  it("lets a parseable FULL_REPLACEMENT win over anchored blocks", () => {
    const text = [
      "Listo.",
      anchoredBlock("does not exist anywhere", "irrelevant"),
      "FULL_REPLACEMENT:",
      "```markdown",
      "rewritten",
      "```"
    ].join("\n");
    const parsed = parseProposalDrafts(runRequest(), text);

    expect(parsed.anchoredEditFailed).toBe(false);
    expect(parsed.drafts).toHaveLength(1);
    expect(parsed.drafts[0]).toMatchObject({ kind: "edit_file", replacement: "rewritten" });
  });

  it("produces both drafts when anchored edits and NEW_DOCUMENT coexist", () => {
    const text = [
      "Listo.",
      anchoredBlock("alpha line", "beta line"),
      "NEW_DOCUMENT: annex.md",
      "```markdown",
      "# Annex",
      "```"
    ].join("\n");
    const parsed = parseProposalDrafts(runRequest(), text);

    expect(parsed.anchoredEditFailed).toBe(false);
    expect(parsed.drafts.map((draft) => draft.kind)).toEqual(["edit_file", "create_file"]);
    expect(parsed.drafts[0].replacement).toBe("# Title\n\nbeta line\n\nclosing line\n");
    expect(parsed.drafts[1].relativePath).toBe("annex.md");
  });

  it("flags failure with no draft when SEARCH does not apply", () => {
    const parsed = parseProposalDrafts(runRequest(), ["Listo.", anchoredBlock("missing text", "x")].join("\n"));

    expect(parsed).toEqual({ drafts: [], anchoredEditFailed: true });
  });

  it("flags failure alongside a successful NEW_DOCUMENT draft", () => {
    const text = [
      "Listo.",
      anchoredBlock("missing text", "x"),
      "NEW_DOCUMENT: annex.md",
      "```markdown",
      "# Annex",
      "```"
    ].join("\n");
    const parsed = parseProposalDrafts(runRequest(), text);

    expect(parsed.anchoredEditFailed).toBe(true);
    expect(parsed.drafts.map((draft) => draft.kind)).toEqual(["create_file"]);
  });

  it("ignores anchored blocks without an active file (nothing promised, no failure)", () => {
    const parsed = parseProposalDrafts(runRequest({ activeFile: null }), anchoredBlock("alpha line", "beta line"));

    expect(parsed).toEqual({ drafts: [], anchoredEditFailed: false });
  });

  it("stays silent on a no-op result, like FULL_REPLACEMENT-identical", () => {
    const parsed = parseProposalDrafts(runRequest(), anchoredBlock("alpha line", "alpha line"));

    expect(parsed).toEqual({ drafts: [], anchoredEditFailed: false });
  });

  it("keeps the legacy wrapper returning drafts only", () => {
    const drafts = parseLegacyProposalDrafts(runRequest(), anchoredBlock("alpha line", "beta line"));

    expect(drafts).toHaveLength(1);
    expect(drafts[0].kind).toBe("edit_file");
  });
});

describe("sanitizeLegacyAssistantText (anchored transport)", () => {
  const failedText = ["Cambié el título.", anchoredBlock("missing text", "x")].join("\n");

  it("strips anchored blocks from visible text on the success path", () => {
    const text = ["I prepared a proposal. Review it in the document.", anchoredBlock("alpha line", "beta line")].join("\n");

    expect(sanitizeLegacyAssistantText(text, true, "en")).toBe("I prepared a proposal. Review it in the document.");
  });

  it("replaces the visible text with the localized failure sentence when the edit failed", () => {
    expect(sanitizeLegacyAssistantText(failedText, false, "en", true)).toBe(
      "I could not apply the proposed edit — ask me to try again."
    );
    expect(sanitizeLegacyAssistantText(failedText, false, "es", true)).toBe(
      "No pude aplicar la edición propuesta — pídeme que lo intente de nuevo."
    );
  });

  it("appends the failure sentence after the proposal sentence when another draft succeeded", () => {
    expect(sanitizeLegacyAssistantText(failedText, true, "en", true)).toBe(
      "I prepared a proposal. Review it in the document.\n\nI could not apply the proposed edit — ask me to try again."
    );
  });

  it("strips blocks without a failure sentence when no active file was promised an edit", () => {
    const text = ["Plain explanation.", anchoredBlock("alpha line", "beta line")].join("\n");

    expect(sanitizeLegacyAssistantText(text, false, "en", false)).toBe("Plain explanation.");
  });
});
