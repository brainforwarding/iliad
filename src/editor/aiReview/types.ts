import type { AgentCreateFileProposal, AgentDeleteFileProposal, AgentEditFileProposal } from "../../types/iliad";

export type EditorReviewState =
  | {
      mode: "edit_file";
      file: AgentEditFileProposal;
      currentContent: string;
      activeHunkId: string | null;
      readOnly?: boolean;
      hideHunkActions?: boolean;
      actionBusy?: boolean;
      onAcceptHunk: (hunkId: string) => void;
      onRejectHunk: (hunkId: string) => void;
      onAcceptFile: () => void;
      onRejectFile: () => void;
      labels: {
        changes: (count: number) => string;
        previous: string;
        next: string;
        acceptAll: string;
        rejectAll: string;
        rejectRemaining: string;
        stale: string;
        acceptChange: string;
        rejectChange: string;
      };
    }
  | {
      mode: "create_file";
      file: AgentCreateFileProposal;
      currentContent: string;
      actionBusy?: boolean;
      onAcceptFile: () => void;
      onRejectFile: () => void;
      labels: {
        create: string;
        discard: string;
        pendingDocument: (path: string) => string;
      };
    }
  | {
      mode: "delete_file";
      file: AgentDeleteFileProposal;
      currentContent: string;
      actionBusy?: boolean;
      onAcceptFile: () => void;
      onRejectFile: () => void;
      labels: {
        delete: string;
        discard: string;
        pendingDeleteDocument: (path: string) => string;
      };
    };
