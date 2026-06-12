import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EXPLICIT_DOCUMENT_CONTEXT_LIMITS,
  parseExplicitMarkdownMentions,
  prepareExplicitDocumentContext,
  preparedRunRequest
} from "../../electron/agent/documentContext";
import { conversationHistoryTokenBudget } from "../../electron/agent/conversationHistory";
import { AgentDocumentToolError, createAgentDocumentTools } from "../../electron/agent/documentTools";
import { hashMarkdown } from "../../electron/agent/hash";
import type { AgentRunRequest } from "../../electron/agent/types";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "iliad-document-context-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function request(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    runId: "run-document-context",
    workspaceRoot: root,
    activeFile: null,
    messages: [],
    prompt: "Use @notes.md.",
    mode: "balanced",
    language: "en",
    ...overrides
  };
}

async function write(relativePath: string, content: string) {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
  return absolutePath;
}

describe("explicit document context", () => {
  it("parses narrow Markdown mentions with punctuation trimming, false-positive rejection, and mention caps", () => {
    const prompt = [
      "Use @file.md, @folder/file.md and @s2.md.",
      "Include @notes/a.markdown; @notes/b.mdown! @notes/c.mkd?",
      "Also allow extensionless slugs like @reporte-control-calidad and @guides/style-draft.",
      "Ignore name@example.md, @plain.txt, @gpt-5, @user_name, and @folder without an extension."
    ].join(" ");

    expect(parseExplicitMarkdownMentions(prompt).map((mention) => mention.path)).toEqual([
      "file.md",
      "folder/file.md",
      "s2.md",
      "notes/a.markdown",
      "notes/b.mdown",
      "notes/c.mkd",
      "reporte-control-calidad",
      "guides/style-draft"
    ]);

    expect(
      parseExplicitMarkdownMentions(
        Array.from({ length: EXPLICIT_DOCUMENT_CONTEXT_LIMITS.maxExplicitMentions + 3 }, (_, index) => `@doc-${index}.md`).join(
          " "
        )
      ).map((mention) => mention.path)
    ).toEqual(["doc-0.md", "doc-1.md", "doc-2.md", "doc-3.md", "doc-4.md", "doc-5.md", "doc-6.md", "doc-7.md"]);
  });

  it("resolves basename mentions beside the active file, workspace-relative mentions from root, and active-file duplicates", async () => {
    const activeContent = "# Active\n";
    const besideContent = "# Beside\n";
    const rootContent = "# Root\n";
    const guideContent = "# Guide\n";
    const activePath = await write("notes/active.md", activeContent);
    await write("notes/rubric.md", besideContent);
    await write("rubric.md", rootContent);
    await write("guides/style.md", guideContent);

    const result = await prepareExplicitDocumentContext({
      request: request({
        activeFile: {
          path: activePath,
          relativePath: "notes/active.md",
          content: activeContent,
          baseHash: hashMarkdown(activeContent)
        },
        prompt: "Compare @rubric.md with @guides/style.md and @notes/active.md."
      }),
      documentTools: createAgentDocumentTools({ workspaceRoot: root })
    });

    expect(result.contextDocuments.map((document) => document.relativePath)).toEqual(["notes/rubric.md", "guides/style.md"]);
    expect(result.contextDocuments[0]).toMatchObject({
      content: besideContent,
      baseHash: hashMarkdown(besideContent),
      source: "explicit_file_mention"
    });
    expect(result.manifestItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "document_read",
          relativePath: "notes/rubric.md",
          inclusion: "full",
          reason: "explicit_file_mention",
          baseHash: hashMarkdown(besideContent),
          correlationId: expect.any(String)
        }),
        expect.objectContaining({
          kind: "document_read",
          relativePath: "guides/style.md",
          inclusion: "full",
          reason: "explicit_file_mention",
          baseHash: hashMarkdown(guideContent),
          correlationId: expect.any(String)
        })
      ])
    );
    expect(result.unresolvedContextReferences).toEqual([]);
  });

  it("resolves extensionless mentions by safe Markdown extension fallback and unique visible basename", async () => {
    const rootContent = "# Reporte\n";
    const nestedContent = "# Plan\n";
    await write("reporte-control-calidad.md", rootContent);
    await write("notes/quality-plan.markdown", nestedContent);
    await write("archive/duplicate-name.md", "# A\n");
    await write("notes/duplicate-name.md", "# B\n");

    const result = await prepareExplicitDocumentContext({
      request: request({
        activeFile: null,
        prompt: "Use @reporte-control-calidad, @quality-plan, and @duplicate-name."
      }),
      documentTools: createAgentDocumentTools({ workspaceRoot: root })
    });

    expect(result.contextDocuments.map((document) => document.relativePath)).toEqual([
      "reporte-control-calidad.md",
      "notes/quality-plan.markdown"
    ]);
    expect(result.contextDocuments[0]).toMatchObject({
      content: rootContent,
      baseHash: hashMarkdown(rootContent),
      source: "explicit_file_mention"
    });
    expect(result.contextDocuments[1]).toMatchObject({
      content: nestedContent,
      baseHash: hashMarkdown(nestedContent),
      source: "explicit_file_mention"
    });
    expect(result.unresolvedContextReferences).toContainEqual(
      expect.objectContaining({ safeDisplayPath: "duplicate-name", reason: "ambiguous" })
    );
    expect(result.sanitizedPrompt).toBe("Use @reporte-control-calidad, @quality-plan, and @duplicate-name.");
  });

  it("preserves social and model handles and resolves basename mentions through the exhaustive search path pass", async () => {
    await write("a/reporte-control-calidad.md", "# Reporte\n");
    await write("z/other.md", "# Other\n");
    // maxListResults no longer constrains mention resolution: lookup goes
    // through the search path pass, not a sliced alphabetical listing.
    const tools = createAgentDocumentTools({ workspaceRoot: root, limits: { maxListResults: 1 } });

    const result = await prepareExplicitDocumentContext({
      request: request({
        activeFile: null,
        prompt: "Ask @gpt-5 about @user_name and @reporte-control-calidad."
      }),
      documentTools: tools
    });

    expect(result.sanitizedPrompt).toBe("Ask @gpt-5 about @user_name and @reporte-control-calidad.");
    expect(result.contextDocuments).toEqual([
      expect.objectContaining({ relativePath: "a/reporte-control-calidad.md", source: "explicit_file_mention" })
    ]);
    expect(result.unresolvedContextReferences).toEqual([]);
  });

  it("refuses basename fallback when the search walk is truncated and no exact match exists", async () => {
    await write("a/reporte-control-calidad.md", "# Reporte\n");
    await write("z/other.md", "# Other\n");
    // maxDirectories: 1 truncates the walk at the root, so the basename can
    // never be confirmed unique — the conservative bail must hold.
    const tools = createAgentDocumentTools({ workspaceRoot: root, limits: { maxDirectories: 1 } });

    const result = await prepareExplicitDocumentContext({
      request: request({ activeFile: null, prompt: "Use @reporte-control-calidad." }),
      documentTools: tools
    });

    expect(result.contextDocuments).toEqual([]);
    expect(result.unresolvedContextReferences).toEqual([
      expect.objectContaining({ safeDisplayPath: "reporte-control-calidad", reason: "not_found" })
    ]);
  });

  it("does not persist unsafe Windows drive-style mentions in unresolved metadata", async () => {
    const result = await prepareExplicitDocumentContext({
      request: request({
        activeFile: null,
        prompt: "Do not read @C:/Users/me/secret.md."
      }),
      documentTools: createAgentDocumentTools({ workspaceRoot: root })
    });

    expect(result.contextDocuments).toEqual([]);
    expect(result.sanitizedPrompt).toBe("Do not read [explicit Markdown context].");
    expect(result.unresolvedContextReferences).toContainEqual(expect.objectContaining({ reason: "unsafe" }));
    expect(result.unresolvedContextReferences[0]).not.toHaveProperty("safeDisplayPath");
    expect(JSON.stringify(result.manifestItems)).not.toContain("C:/Users/me/secret.md");
  });

  it("skips unsafe, hidden, ignored, symlinked, missing, oversized, duplicate, and capped reads without persisting content", async () => {
    await write("ok-1.md", "OK_ONE_CONTENT");
    await write("ok-2.md", "OK_TWO_CONTENT");
    await write("large.md", "LARGE_CONTENT_SENTINEL");
    await write("dist/ignored.md", "IGNORED_CONTENT_SENTINEL");
    await write(".hidden.md", "HIDDEN_CONTENT_SENTINEL");
    const symlinkTarget = await write("target.md", "SYMLINK_CONTENT_SENTINEL");
    try {
      await symlink(symlinkTarget, path.join(root, "link.md"));
    } catch {
      // Some platforms disallow symlink creation without elevated permissions.
    }

    const result = await prepareExplicitDocumentContext({
      request: request({
        prompt: [
          "Use @ok-1.md @ok-1.md @ok-2.md @large.md @missing.md",
          "@dist/ignored.md @.hidden.md @../secret.md @link.md"
        ].join(" ")
      }),
      documentTools: createAgentDocumentTools({ workspaceRoot: root, limits: { maxReadBytes: 16 } }),
      limits: {
        ...EXPLICIT_DOCUMENT_CONTEXT_LIMITS,
        maxIncludedContextDocuments: 1,
        maxTotalContextBytes: 64,
        maxTotalContextTokens: 64
      }
    });

    expect(result.contextDocuments.map((document) => document.relativePath)).toEqual(["ok-1.md"]);
    expect(result.unresolvedContextReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ safeDisplayPath: "ok-1.md", reason: "duplicate" }),
        expect.objectContaining({ safeDisplayPath: "ok-2.md", reason: "budget_exceeded" }),
        expect.objectContaining({ safeDisplayPath: "large.md", reason: "oversized" }),
        expect.objectContaining({ safeDisplayPath: "missing.md", reason: "not_found" }),
        expect.objectContaining({ reason: "unsafe" })
      ])
    );
    expect(result.manifestItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "document_reference",
          inclusion: "excluded",
          reason: "explicit_file_mention_unresolved",
          correlationId: expect.any(String)
        })
      ])
    );

    const serialized = JSON.stringify({
      manifestItems: result.manifestItems,
      unresolvedContextReferences: result.unresolvedContextReferences
    });
    expect(serialized).not.toContain("OK_ONE_CONTENT");
    expect(serialized).not.toContain("OK_TWO_CONTENT");
    expect(serialized).not.toContain("LARGE_CONTENT_SENTINEL");
    expect(serialized).not.toContain("IGNORED_CONTENT_SENTINEL");
    expect(serialized).not.toContain("HIDDEN_CONTENT_SENTINEL");
    expect(serialized).not.toContain("SYMLINK_CONTENT_SENTINEL");
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain("../secret.md");
  });

  it("reads manual attachments through document tools and ignores renderer-supplied content and hashes", async () => {
    const diskContent = "REAL_MANUAL_ATTACHMENT_CONTENT";
    await write("manual.md", diskContent);

    const result = await prepareExplicitDocumentContext({
      request: request({
        prompt: "Use the attached document.",
        contextAttachments: [
          {
            relativePath: "manual.md",
            source: "manual_attachment",
            content: "FORGED_RENDERER_ATTACHMENT_CONTENT",
            baseHash: "forged-hash"
          }
        ] as unknown as AgentRunRequest["contextAttachments"]
      }),
      documentTools: createAgentDocumentTools({ workspaceRoot: root })
    });

    expect(result.attachmentCount).toBe(1);
    expect(result.contextDocuments).toEqual([
      expect.objectContaining({
        relativePath: "manual.md",
        content: diskContent,
        baseHash: hashMarkdown(diskContent),
        source: "manual_attachment"
      })
    ]);
    expect(result.manifestItems).toContainEqual(
      expect.objectContaining({
        kind: "document_read",
        relativePath: "manual.md",
        reason: "manual_context_attachment",
        baseHash: hashMarkdown(diskContent)
      })
    );
    expect(JSON.stringify(result.manifestItems)).not.toContain("REAL_MANUAL_ATTACHMENT_CONTENT");
    expect(JSON.stringify(result.manifestItems)).not.toContain("FORGED_RENDERER_ATTACHMENT_CONTENT");
  });

  it("rejects non-Markdown manual attachment paths without persisting the supplied path", async () => {
    const result = await prepareExplicitDocumentContext({
      request: request({
        prompt: "Use the attached document.",
        contextAttachments: [
          { relativePath: "private-notes.txt", source: "manual_attachment" }
        ]
      }),
      documentTools: createAgentDocumentTools({ workspaceRoot: root })
    });

    expect(result.contextDocuments).toEqual([]);
    expect(result.unresolvedContextReferences).toEqual([
      expect.objectContaining({
        reason: "unsafe",
        source: "manual_attachment"
      })
    ]);
    expect(JSON.stringify(result.unresolvedContextReferences)).not.toContain("private-notes.txt");
    expect(JSON.stringify(result.manifestItems)).not.toContain("private-notes.txt");
  });

  it("de-duplicates in current-file, manual attachment, typed mention order with source-specific manifest reasons", async () => {
    const activeContent = "# Active\n";
    const activePath = await write("active.md", activeContent);
    await write("shared.md", "# Shared\n");
    await write("manual.md", "# Manual\n");
    await write("typed.md", "# Typed\n");

    const result = await prepareExplicitDocumentContext({
      request: request({
        activeFile: {
          path: activePath,
          relativePath: "active.md",
          content: activeContent,
          baseHash: hashMarkdown(activeContent)
        },
        prompt: "Compare @shared.md @typed.md @manual.md.",
        contextAttachments: [
          { relativePath: "active.md", source: "manual_attachment" },
          { relativePath: "shared.md", source: "manual_attachment" },
          { relativePath: "manual.md", source: "manual_attachment" }
        ]
      }),
      documentTools: createAgentDocumentTools({ workspaceRoot: root })
    });

    expect(result.contextDocuments.map((document) => [document.relativePath, document.source])).toEqual([
      ["shared.md", "manual_attachment"],
      ["manual.md", "manual_attachment"],
      ["typed.md", "explicit_file_mention"]
    ]);
    expect(result.unresolvedContextReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          safeDisplayPath: "active.md",
          reason: "duplicate",
          source: "manual_attachment"
        }),
        expect.objectContaining({
          safeDisplayPath: "shared.md",
          reason: "duplicate",
          source: "explicit_file_mention"
        }),
        expect.objectContaining({
          safeDisplayPath: "manual.md",
          reason: "duplicate",
          source: "explicit_file_mention"
        })
      ])
    );
    expect(result.manifestItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "document_reference",
          relativePath: "active.md",
          reason: "manual_context_attachment_unresolved"
        }),
        expect.objectContaining({
          kind: "document_reference",
          relativePath: "shared.md",
          reason: "explicit_file_mention_unresolved"
        })
      ])
    );
  });
});

describe("prepared run request history and reference index", () => {
  it("trims history by budget, counts omissions, and filters the index against the prepared packet", async () => {
    const activeContent = "# Active\n";
    const activePath = await write("notes/active.md", activeContent);
    await write("guide.md", "# Guide\n");
    const bulky = "x".repeat(conversationHistoryTokenBudget * 4);
    const runRequest = request({
      activeFile: {
        path: activePath,
        relativePath: "notes/active.md",
        content: activeContent,
        baseHash: hashMarkdown(activeContent)
      },
      messages: [
        { role: "user", content: "oldest question" },
        { role: "assistant", content: bulky },
        { role: "user", content: "newest question" }
      ],
      prompt: "Compare with @guide.md.",
      previouslyReferencedDocuments: ["guide.md", "notes/active.md", "annex.md"]
    });
    const context = await prepareExplicitDocumentContext({
      request: runRequest,
      documentTools: createAgentDocumentTools({ workspaceRoot: root })
    });

    const prepared = preparedRunRequest(runRequest, context);

    expect(prepared.messages.map((message) => message.content)).toEqual(["newest question"]);
    expect(prepared.omittedHistoryMessageCount).toBe(2);
    // guide.md is explicit context this turn and notes/active.md is the active
    // file; only annex.md survives into the identifier index.
    expect(prepared.previouslyReferencedDocuments).toEqual(["annex.md"]);
  });

  it("attaches the main-side conversation summary and never a renderer-supplied one", async () => {
    const bulky = "x".repeat(conversationHistoryTokenBudget * 4);
    const runRequest = request({
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
        { role: "user", content: bulky }
      ],
      prompt: "Sigue."
    });
    const context = await prepareExplicitDocumentContext({
      request: runRequest,
      documentTools: createAgentDocumentTools({ workspaceRoot: root })
    });

    const withSummary = preparedRunRequest(runRequest, context, {
      text: "## Decisions\n- usar 'estudiantes'",
      coveredMessageCount: 2
    });
    expect(withSummary.omittedHistoryMessageCount).toBe(2);
    expect(withSummary.conversationSummary).toEqual({
      text: "## Decisions\n- usar 'estudiantes'",
      coveredMessageCount: 2
    });

    // Coverage beyond the omitted prefix never rides along.
    const overCovered = preparedRunRequest(runRequest, context, { text: "stale", coveredMessageCount: 5 });
    expect(overCovered.conversationSummary).toBeUndefined();

    // The construction never reads request.conversationSummary (forging vector).
    const forged = preparedRunRequest(
      { ...runRequest, conversationSummary: { text: "FORGED", coveredMessageCount: 1 } } as never,
      context
    );
    expect(forged.conversationSummary).toBeUndefined();
  });

  it("omits the index field entirely when every candidate is already in the packet", async () => {
    const activeContent = "# Active\n";
    const activePath = await write("active.md", activeContent);
    const runRequest = request({
      activeFile: {
        path: activePath,
        relativePath: "active.md",
        content: activeContent,
        baseHash: hashMarkdown(activeContent)
      },
      prompt: "Just help.",
      previouslyReferencedDocuments: ["active.md"]
    });
    const context = await prepareExplicitDocumentContext({
      request: runRequest,
      documentTools: createAgentDocumentTools({ workspaceRoot: root })
    });

    const prepared = preparedRunRequest(runRequest, context);

    expect(prepared.previouslyReferencedDocuments).toBeUndefined();
    expect(prepared.omittedHistoryMessageCount).toBe(0);
  });
});

describe("workspace rules (AGENTS.md)", () => {
  it("reads root AGENTS.md into the prepared request, seeds dedupe, and stays out of the reference index", async () => {
    await write("AGENTS.md", "Di estudiantes, nunca alumnos.\n");
    const runRequest = request({
      prompt: "Aplica las reglas de @AGENTS.md por favor.",
      previouslyReferencedDocuments: ["AGENTS.md", "annex.md"]
    });
    const context = await prepareExplicitDocumentContext({
      request: runRequest,
      documentTools: createAgentDocumentTools({ workspaceRoot: root })
    });
    const prepared = preparedRunRequest(runRequest, context);

    expect(prepared.workspaceRules).toMatchObject({
      relativePath: "AGENTS.md",
      content: "Di estudiantes, nunca alumnos.\n"
    });
    // The @mention deduped against the rules read instead of double-including.
    expect(context.contextDocuments).toEqual([]);
    expect(context.unresolvedContextReferences).toContainEqual(
      expect.objectContaining({ safeDisplayPath: "AGENTS.md", reason: "duplicate" })
    );
    // Index hygiene: standing rules never echo as a conversational reference.
    expect(prepared.previouslyReferencedDocuments).toEqual(["annex.md"]);
  });

  it("treats absent, whitespace-only, and active-file AGENTS.md as no rules", async () => {
    const tools = createAgentDocumentTools({ workspaceRoot: root });
    const absent = await prepareExplicitDocumentContext({ request: request({ prompt: "Hola." }), documentTools: tools });
    expect(absent.workspaceRules).toBeUndefined();
    expect(absent.workspaceRulesExcluded).toBeUndefined();

    await write("AGENTS.md", "   \n\n  ");
    const blank = await prepareExplicitDocumentContext({ request: request({ prompt: "Hola." }), documentTools: tools });
    expect(blank.workspaceRules).toBeUndefined();

    await write("AGENTS.md", "Reglas reales.\n");
    const activeContent = "Reglas reales.\n";
    const activeRules = await prepareExplicitDocumentContext({
      request: request({
        prompt: "Hola.",
        activeFile: {
          path: path.join(root, "AGENTS.md"),
          relativePath: "AGENTS.md",
          content: activeContent,
          baseHash: hashMarkdown(activeContent)
        }
      }),
      documentTools: tools
    });
    expect(activeRules.workspaceRules).toBeUndefined();
  });

  it("excludes oversized rules honestly instead of truncating or silently dropping", async () => {
    await write("AGENTS.md", "x".repeat(2_001 * 4));
    const context = await prepareExplicitDocumentContext({
      request: request({ prompt: "Hola." }),
      documentTools: createAgentDocumentTools({ workspaceRoot: root })
    });

    expect(context.workspaceRules).toBeUndefined();
    expect(context.workspaceRulesExcluded).toBe(true);

    // The >maxReadBytes path maps the readDocument oversized error to the same
    // honest exclusion (driven via a stub: deterministic on every platform).
    const oversizedTools = {
      ...createAgentDocumentTools({ workspaceRoot: root }),
      readDocument: async () => {
        throw new AgentDocumentToolError("oversized", "too big");
      }
    };
    const giant = await prepareExplicitDocumentContext({
      request: request({ prompt: "Hola." }),
      documentTools: oversizedTools as never
    });
    expect(giant.workspaceRulesExcluded).toBe(true);
  });
});
