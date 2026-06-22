import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { AssistantPendingProposals } from "../../src/components/assistant/AssistantPendingProposals";
import { appStrings } from "../../src/i18n/strings";
import type { AgentChangeProposal, AgentProposalFileChange } from "../../src/types/iliad";

function editFile(overrides: Partial<Extract<AgentProposalFileChange, { kind: "edit_file" }>> = {}) {
  return {
    id: "file-1",
    kind: "edit_file" as const,
    status: "pending" as const,
    relativePath: "doc.md",
    baseHash: "hash",
    baseContent: "old\n",
    replacement: "new\n",
    unifiedDiff: "",
    hunks: [
      {
        id: "hunk-1",
        status: "pending" as const,
        anchorLine: 1,
        oldStartLine: 1,
        oldLines: ["old"],
        newLines: ["new"]
      }
    ],
    ...overrides
  };
}

function proposal(overrides: Partial<AgentChangeProposal> = {}): AgentChangeProposal {
  return {
    id: "proposal-1",
    runId: "run-1",
    workspaceRoot: "/workspace",
    title: "Edit doc.md",
    summary: "Prepared changes.",
    createdAt: "2026-06-21T10:00:00.000Z",
    updatedAt: "2026-06-21T10:00:00.000Z",
    model: "test",
    source: { kind: "openai_response" },
    status: "pending",
    files: [editFile()],
    ...overrides
  };
}

describe("AssistantPendingProposals", () => {
  it("renders internal proposals but excludes external filesystem review", () => {
    const html = renderToStaticMarkup(
      <AssistantPendingProposals
        labels={appStrings.en.assistant}
        proposals={[
          proposal({ id: "internal", files: [editFile({ relativePath: "internal.md" })] }),
          proposal({
            id: "external",
            title: "External review",
            metadata: {
              kind: "external_filesystem",
              baselineId: "baseline",
              snapshotId: "snapshot",
              liveDisk: true,
              sessionScoped: true
            },
            files: [editFile({ relativePath: "external.md" })]
          })
        ]}
        onAcceptProposalFile={async () => undefined}
        onRejectProposalFile={async () => undefined}
      />
    );

    expect(html).toContain("internal.md");
    expect(html).not.toContain("external.md");
    expect(html).not.toContain("External review");
  });

  it("accepts and rejects every mutable file in a proposal card", async () => {
    const accepted: string[] = [];
    const rejected: string[] = [];
    const element = AssistantPendingProposals({
      labels: appStrings.en.assistant,
      proposals: [
        proposal({
          files: [
            editFile({ id: "first", relativePath: "first.md" }),
            editFile({ id: "second", relativePath: "second.md" })
          ]
        })
      ],
      onAcceptProposalFile: async (_proposalId, fileId) => {
        accepted.push(fileId);
      },
      onRejectProposalFile: async (_proposalId, fileId) => {
        rejected.push(fileId);
      }
    }) as ReactElement;

    const [, cards] = element.props.children as [ReactElement, ReactElement[]];
    const [, actions] = cards[0]!.props.children as [ReactElement, ReactElement];
    const [acceptButton, rejectButton] = actions.props.children as [ReactElement, ReactElement];

    acceptButton.props.onClick();
    await Promise.resolve();
    await Promise.resolve();

    rejectButton.props.onClick();
    await Promise.resolve();
    await Promise.resolve();

    expect(accepted).toEqual(["first", "second"]);
    expect(rejected).toEqual(["first", "second"]);
  });

  it("accepts only the queue-visible same-path proposal card", async () => {
    const accepted: Array<{ proposalId: string; fileId: string }> = [];
    const element = AssistantPendingProposals({
      labels: appStrings.en.assistant,
      proposals: [
        proposal({
          id: "older",
          title: "Older edit",
          runId: "run-older",
          createdAt: "2026-06-21T10:00:00.000Z",
          files: [editFile({ id: "older-file", relativePath: "doc.md" })]
        }),
        proposal({
          id: "newer",
          title: "Newer edit",
          runId: "run-newer",
          createdAt: "2026-06-21T10:01:00.000Z",
          files: [editFile({ id: "newer-file", relativePath: "doc.md" })]
        })
      ],
      onAcceptProposalFile: async (proposalId, fileId) => {
        accepted.push({ proposalId, fileId });
      },
      onRejectProposalFile: async () => undefined
    }) as ReactElement;

    const [, cards] = element.props.children as [ReactElement, ReactElement[]];
    const [, actions] = cards[0]!.props.children as [ReactElement, ReactElement];
    const [acceptButton] = actions.props.children as [ReactElement, ReactElement];

    expect(cards).toHaveLength(1);

    acceptButton.props.onClick();
    await Promise.resolve();
    await Promise.resolve();

    expect(accepted).toEqual([{ proposalId: "newer", fileId: "newer-file" }]);
  });
});
