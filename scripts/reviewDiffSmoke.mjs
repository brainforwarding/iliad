import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildLineReviewHunks,
  hasMutableReviewHunks,
  reconstructContent
} from "../dist-electron/agent/reviewDiff.js";
import { AgentProposalStore } from "../dist-electron/agent/proposalStore.js";
import {
  createOpenAiResponse,
  parseLegacyProposalDrafts,
  sanitizeLegacyAssistantText,
  sanitizeThinkingSummary
} from "../dist-electron/agent/openaiResponses.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function withStatus(hunks, status) {
  return hunks.map((hunk) => ({ ...hunk, status }));
}

function pureSmoke() {
  const base = "title\r\n\r\nalpha\r\nbeta\r\nsame\r\nrepeat\r\nrepeat\r\nend";
  const replacement = "preface\r\ntitle\r\n\r\nalpha changed\r\nsame\r\nrepeat\r\nrepeat\r\nend\r\n";
  const hunks = buildLineReviewHunks(base, replacement, "file-1");

  assert(hunks.length > 0, "diff should create hunks");
  assert(hunks.every((hunk, index) => hunk.id === `file-1-hunk-${index + 1}`), "hunk ids should be stable");
  assert(reconstructContent(base, hunks) === base, "all-pending reconstruction should equal base");
  assert(reconstructContent(base, withStatus(hunks, "accepted")) === replacement, "all-accepted reconstruction should equal replacement");

  const mixed = hunks.map((hunk, index) => ({ ...hunk, status: index === 0 ? "accepted" : "rejected" }));
  assert(reconstructContent(base, mixed).startsWith("preface\r\n"), "mixed reconstruction should include accepted insertion");
  assert(reconstructContent("no trailing", buildLineReviewHunks("no trailing", "no trailing changed", "file-2")) === "no trailing", "no trailing newline should round-trip");
  assert(
    reconstructContent("blank\n\n", buildLineReviewHunks("blank\n\n", "blank\nextra\n\n", "file-3")) === "blank\n\n",
    "blank final lines should round-trip"
  );

  const startInsert = buildLineReviewHunks("body\n", "start\nbody\n", "file-4")[0];
  assert(startInsert.oldLines.length === 0 && startInsert.anchorLine === 0, "start insertion should anchor before line 1");

  const endInsert = buildLineReviewHunks("body\n", "body\nend\n", "file-5").at(-1);
  assert(endInsert?.oldLines.length === 0 && endInsert.anchorLine === 1, "end insertion should anchor after final base line");

  assert(!hasMutableReviewHunks({ hunks: withStatus(hunks, "accepted") }), "accepted hunks should not be mutable");
  assert(
    hasMutableReviewHunks({ hunks: hunks.map((hunk, index) => ({ ...hunk, status: index === 0 ? "accepted" : "stale" })) }),
    "accepted plus stale hunks should remain mutable"
  );
}

function providerSanitizerSmoke() {
  assert(sanitizeThinkingSummary("### Reviewing context\n- Checking the active document") === "Reviewing context Checking the active document", "thinking summary should strip markdown and collapse whitespace");
  assert(sanitizeThinkingSummary("```markdown\nsecret\n```") === "", "thinking summary should drop fenced code");
  assert(sanitizeThinkingSummary("raw reasoning_text delta") === "", "thinking summary should drop raw reasoning references");

  const request = {
    runId: "run-provider-smoke",
    workspaceRoot: "/tmp",
    activeFile: {
      path: "/tmp/doc.md",
      relativePath: "doc.md",
      content: "old\n",
      baseHash: "base"
    },
    messages: [],
    prompt: "edit",
    mode: "balanced",
    language: "en"
  };
  const providerText = [
    "Here is the diff.",
    "```diff",
    "-old",
    "+new",
    "```",
    "Then the full replacement.",
    "FULL_REPLACEMENT:",
    "```markdown",
    "new",
    "```"
  ].join("\n");
  const drafts = parseLegacyProposalDrafts(request, providerText);

  assert(drafts.length === 1 && drafts[0].kind === "edit_file", "legacy proposal parser should still create edit proposals");
  assert(
    sanitizeLegacyAssistantText(providerText, drafts.length > 0, "en") === "I prepared a proposal. Review it in the document.",
    "proposal visible text should stay clean"
  );
}

function providerRequest() {
  return {
    runId: `run-provider-${Math.random().toString(16).slice(2)}`,
    workspaceRoot: "/tmp",
    activeFile: null,
    messages: [],
    prompt: "Say done.",
    mode: "balanced",
    language: "en"
  };
}

function sseResponse(events) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" }
  });
}

async function providerStreamingSmoke() {
  const originalFetch = globalThis.fetch;
  const requestBodies = [];

  try {
    globalThis.fetch = async (_url, init) => {
      requestBodies.push(JSON.parse(init.body));

      if (requestBodies.length === 1) {
        return sseResponse([
          {
            type: "error",
            error: {
              message: "Reasoning summaries require organization verification."
            }
          }
        ]);
      }

      return sseResponse([
        { type: "response.created", response: { id: "resp_retry" } },
        { type: "response.output_text.delta", delta: "Done" },
        { type: "response.completed", response: { id: "resp_retry", output_text: "Done" } }
      ]);
    };

    const retryResult = await createOpenAiResponse({
      apiKey: "test-key",
      model: "gpt-5-mini",
      request: providerRequest(),
      signal: new AbortController().signal
    });

    assert(retryResult.text === "Done", "stream errors for unavailable reasoning summaries should retry cleanly");
    assert(requestBodies[0].reasoning?.summary === "auto", "reasoning summaries should use OpenAI's auto setting");
    assert(!("reasoning" in requestBodies[1]), "reasoning-summary retry should remove reasoning options");

    const runEvents = [];
    globalThis.fetch = async () =>
      sseResponse([
        {
          type: "response.completed",
          response: {
            id: "resp_summary",
            output: [
              {
                type: "reasoning",
                summary: [{ type: "summary_text", text: "**Reviewing markdown**\n\nChecking structure." }]
              },
              {
                type: "message",
                content: [{ type: "output_text", text: "Done" }]
              }
            ]
          }
        }
      ]);

    const summaryResult = await createOpenAiResponse({
      apiKey: "test-key",
      model: "gpt-5-mini",
      request: providerRequest(),
      signal: new AbortController().signal,
      onRunEvent: (event) => runEvents.push(event)
    });

    assert(summaryResult.text === "Done", "completed response stream should parse output text");
    assert(
      runEvents.some((event) => event.type === "thinking_done" && event.text.includes("Reviewing markdown")),
      "completed response stream should emit reasoning summaries when OpenAI sends them at completion"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function storeSmoke() {
  const root = await mkdtemp(path.join(os.tmpdir(), "iliad-review-workspace-"));
  const userData = await mkdtemp(path.join(os.tmpdir(), "iliad-review-userdata-"));

  try {
    const filePath = path.join(root, "doc.md");
    const base = "one\nsame\nthree\nsame\nfive\n";
    const replacement = "ONE\nsame\nthree\nsame\nFIVE\n";
    await writeFile(filePath, base, "utf8");

    const store = new AgentProposalStore(userData);
    const proposal = await store.saveProposal({
      id: "proposal-smoke",
      runId: "run-smoke",
      workspaceRoot: root,
      title: "Edit doc.md",
      summary: "Smoke edit",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      model: "smoke",
      source: { kind: "legacy_marker_adapter" },
      status: "pending",
      files: [
        {
          id: "file-smoke",
          kind: "edit_file",
          status: "pending",
          relativePath: "doc.md",
          baseHash: "",
          baseContent: base,
          replacement,
          unifiedDiff: ""
        }
      ]
    });
    const file = proposal.files[0];
    assert(file.kind === "edit_file" && file.hunks?.length === 2, "store should persist review hunks");

    const first = file.hunks[0];
    await store.resolveProposalHunk(root, proposal.id, file.id, first.id, "accept");
    assert((await readFile(filePath, "utf8")).startsWith("ONE\n"), "accepting one hunk should write only that hunk");

    await writeFile(filePath, "manual\n", "utf8");
    const stale = await store.resolveProposalHunk(root, proposal.id, file.id, file.hunks[1].id, "accept");
    const staleFile = stale.proposal.files[0];
    assert(staleFile.kind === "edit_file" && staleFile.hunks?.some((hunk) => hunk.status === "stale"), "manual edits should mark unresolved hunks stale");
    assert((await readFile(filePath, "utf8")) === "manual\n", "stale resolve should not overwrite manual edits");

    const createProposal = await store.saveProposal({
      id: "proposal-create",
      runId: "run-create",
      workspaceRoot: root,
      title: "Create new.md",
      summary: "Smoke create",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      model: "smoke",
      source: { kind: "legacy_marker_adapter" },
      status: "pending",
      files: [
        {
          id: "file-create",
          kind: "create_file",
          status: "pending",
          relativePath: "new.md",
          content: "new\n",
          unifiedDiff: ""
        }
      ]
    });
    const newPath = path.join(root, "new.md");
    await readFile(newPath, "utf8").then(
      () => assert(false, "create proposal should not write before apply"),
      () => undefined
    );
    await store.applyProposalFile(root, createProposal.id, "file-create");
    assert((await readFile(newPath, "utf8")) === "new\n", "create apply should write generated content");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  }
}

async function legacyMigrationSmoke() {
  const root = await mkdtemp(path.join(os.tmpdir(), "iliad-review-legacy-workspace-"));
  const userData = await mkdtemp(path.join(os.tmpdir(), "iliad-review-legacy-userdata-"));

  try {
    const base = "base\n";
    const replacement = "changed\n";
    await writeFile(path.join(root, "doc.md"), base, "utf8");
    await mkdir(path.join(userData, "assistant"), { recursive: true });
    await writeFile(
      path.join(userData, "assistant", "proposals.json"),
      `${JSON.stringify(
        ["applied", "rejected", "stale", "failed"].map((status) => ({
          id: `proposal-legacy-${status}`,
          runId: `run-legacy-${status}`,
          workspaceRoot: root,
          title: `Legacy ${status}`,
          summary: "Legacy proposal without hunks",
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          model: "smoke",
          source: { kind: "legacy_marker_adapter" },
          status,
          files: [
            {
              id: `file-legacy-${status}`,
              kind: "edit_file",
              status,
              relativePath: "doc.md",
              baseHash: "",
              baseContent: base,
              replacement,
              unifiedDiff: ""
            }
          ]
        })),
        null,
        2
      )}\n`,
      "utf8"
    );

    const store = new AgentProposalStore(userData);
    const proposals = await store.listProposals(root);
    const byId = new Map(proposals.map((proposal) => [proposal.id, proposal]));
    const appliedFile = byId.get("proposal-legacy-applied").files[0];
    const rejectedFile = byId.get("proposal-legacy-rejected").files[0];
    const staleFile = byId.get("proposal-legacy-stale").files[0];
    const failedFile = byId.get("proposal-legacy-failed").files[0];

    assert(appliedFile.status === "applied", "legacy applied proposal should stay applied after hunk migration");
    assert(appliedFile.hunks.every((hunk) => hunk.status === "accepted"), "legacy applied hunks should become accepted");
    assert(rejectedFile.status === "rejected", "legacy rejected proposal should stay rejected after hunk migration");
    assert(rejectedFile.hunks.every((hunk) => hunk.status === "rejected"), "legacy rejected hunks should become rejected");
    assert(staleFile.status === "stale", "legacy stale proposal should stay stale after hunk migration");
    assert(staleFile.hunks.every((hunk) => hunk.status === "stale"), "legacy stale hunks should stay stale");
    assert(failedFile.status === "failed", "legacy failed proposal should stay failed after hunk migration");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  }
}

pureSmoke();
providerSanitizerSmoke();
await providerStreamingSmoke();
await storeSmoke();
await legacyMigrationSmoke();
console.log("review diff smoke passed");
