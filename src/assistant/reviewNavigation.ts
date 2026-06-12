import { fileHasMutableReview } from "./assistantUtils";
import { normalizeRelativePath, sameRelativePath } from "./pendingFileTree";
import type { AgentChangeProposal } from "../types/iliad";

export interface ReviewTarget {
  proposalId: string;
  fileId: string;
}

export function chooseInitialReviewTarget({
  proposals,
  runId,
  runActiveRelativePath,
  currentActiveRelativePath,
  editorNavigationChangedDuringRun
}: {
  proposals: AgentChangeProposal[];
  runId: string;
  runActiveRelativePath: string | null;
  currentActiveRelativePath: string | null;
  editorNavigationChangedDuringRun: boolean;
}): ReviewTarget | null {
  if (editorNavigationChangedDuringRun) {
    return null;
  }

  const runFiles = proposals
    .filter((proposal) => proposal.runId === runId)
    .flatMap((proposal) =>
      proposal.files
        .filter(fileHasMutableReview)
        .map((file) => ({
          proposalId: proposal.id,
          file
        }))
    )
    .filter(({ file }) => Boolean(normalizeRelativePath(file.relativePath)));

  const activeRelativePath = runActiveRelativePath ?? currentActiveRelativePath;

  if (activeRelativePath) {
    const currentEdit = runFiles.find(
      ({ file }) => file.kind === "edit_file" && sameRelativePath(file.relativePath, activeRelativePath)
    );

    if (currentEdit) {
      return {
        proposalId: currentEdit.proposalId,
        fileId: currentEdit.file.id
      };
    }
  }

  if (runFiles.length !== 1) {
    return null;
  }

  return {
    proposalId: runFiles[0].proposalId,
    fileId: runFiles[0].file.id
  };
}
