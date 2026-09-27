import type { FileTreeNode } from "../types/iliad";

/**
 * The renderer's view of the naming IPC (spec 2026-09-27 "Name untitled
 * documents", Interfaces): the guarded rename and the AI title live in main.
 * Read through this adapter so the renderer tolerates a preload without them
 * (naming then silently never happens).
 */
export type AutoRenameDocumentResult =
  | { ok: true; node: FileTreeNode; relativePath: string }
  | { ok: false; reason: "changed" | "under_review" | "collision" | "failed" };

export type SuggestDocumentNameResult = { ok: true; title: string } | { ok: false; reason: string };

export interface DocumentNamingApi {
  autoRenameDocument: (
    workspaceRoot: string,
    filePath: string,
    request: { expectedHash: string; stem: string }
  ) => Promise<AutoRenameDocumentResult>;
  suggestDocumentName: (request: { requestId: string; language: "en" | "es"; text: string }) => Promise<SuggestDocumentNameResult>;
  cancelSuggestDocumentName: (requestId: string) => void;
}

type MaybeNamingBridge = Partial<DocumentNamingApi>;

/** The naming methods of `window.iliad`, or null when the preload does not expose them. */
export function documentNamingApi(): DocumentNamingApi | null {
  const bridge = (typeof window === "undefined" ? undefined : (window.iliad as unknown as MaybeNamingBridge | undefined));

  if (
    !bridge ||
    typeof bridge.autoRenameDocument !== "function" ||
    typeof bridge.suggestDocumentName !== "function" ||
    typeof bridge.cancelSuggestDocumentName !== "function"
  ) {
    return null;
  }

  return {
    autoRenameDocument: (workspaceRoot, filePath, request) =>
      (bridge.autoRenameDocument as DocumentNamingApi["autoRenameDocument"])(workspaceRoot, filePath, request),
    suggestDocumentName: (request) => (bridge.suggestDocumentName as DocumentNamingApi["suggestDocumentName"])(request),
    cancelSuggestDocumentName: (requestId) =>
      (bridge.cancelSuggestDocumentName as DocumentNamingApi["cancelSuggestDocumentName"])(requestId)
  };
}
