type ReviewDiagnosticPrimitive = string | number | boolean | null;

const pendingFilePathPrefix = "iliad-review://";
const pendingDirectoryPathPrefix = "iliad-review-dir://";

const primitiveDetailKeys = new Set([
  "activeReviewFileId",
  "activeReviewKind",
  "activeReviewProposalId",
  "ancestorFound",
  "autoSelectDecision",
  "clearReason",
  "count",
  "fileCount",
  "fileFound",
  "fileId",
  "fileKind",
  "hasActiveReview",
  "hasFile",
  "hasProposal",
  "inFlight",
  "key",
  "metadataKind",
  "navigationChangedDuringRun",
  "nodeFound",
  "nodeKind",
  "nodePathKind",
  "openResultKind",
  "openedNode",
  "pendingReviewCount",
  "proposalCount",
  "proposalId",
  "proposalWorkspaceMatches",
  "revealPathKind",
  "rowFound",
  "runId",
  "selectedTreePathKind",
  "sourceKind",
  "targetFileId",
  "targetKind",
  "targetProposalId",
  "workspaceMatches",
  "workspacePathKind"
]);

const relativeDetailKeys: Record<string, string> = {
  activeRelativePath: "activeRel",
  activeRel: "activeRel",
  activeReviewRelativePath: "activeReviewRel",
  activeReviewRel: "activeReviewRel",
  currentActiveRelativePath: "currentActiveRel",
  currentActiveRel: "currentActiveRel",
  nodeRelativePath: "nodeRel",
  nodeRel: "nodeRel",
  previousActiveRelativePath: "previousActiveRel",
  previousActiveRel: "previousActiveRel",
  revealRelativePath: "revealRel",
  revealRel: "revealRel",
  runActiveRelativePath: "runActiveRel",
  runActiveRel: "runActiveRel",
  selectedTreeRelativePath: "selectedTreeRel",
  selectedTreeRel: "selectedTreeRel",
  targetRelativePath: "targetRel",
  targetRel: "targetRel"
};

const pathKindKeys: Record<string, string> = {
  currentPath: "currentPathKind",
  nodePath: "nodePathKind",
  path: "pathKind",
  previousPath: "previousPathKind",
  revealPath: "revealPathKind",
  selectedTreePath: "selectedTreePathKind",
  workspacePath: "workspacePathKind"
};

let reviewNavigationSequence = 0;

function reviewDebugEnabled() {
  if (import.meta.env.DEV) {
    return true;
  }

  try {
    return typeof window !== "undefined" && window.localStorage.getItem("iliad.debug.reviewNavigation") === "1";
  } catch {
    return false;
  }
}

export function logReviewNavigation(event: string, details: Record<string, unknown> = {}) {
  if (reviewDebugEnabled()) {
    console.info(`[review-nav] ${event}`, details);
  }

  persistReviewNavigationDiagnostic(event, details);
}

export function safeReviewDiagnosticDetails(
  details: Record<string, unknown> = {}
): Record<string, ReviewDiagnosticPrimitive> {
  const safe: Record<string, ReviewDiagnosticPrimitive> = {};

  for (const [key, value] of Object.entries(details)) {
    if (key === "target" || key === "reviewTarget") {
      addTargetDetails(safe, value);
      continue;
    }

    const relativeOutputKey = relativeDetailKeys[key];

    if (relativeOutputKey) {
      const relativeValue = safeRelativeIdentity(value);

      if (relativeValue !== undefined) {
        safe[relativeOutputKey] = relativeValue;
      }

      continue;
    }

    const pathKindOutputKey = pathKindKeys[key];

    if (pathKindOutputKey) {
      const classified = classifyPath(value);

      if (classified.kind !== "unknown") {
        safe[pathKindOutputKey] = classified.kind;
      }

      addPathRelativeIdentity(safe, key, classified);
      continue;
    }

    if (primitiveDetailKeys.has(key)) {
      const primitive = safePrimitive(value);

      if (primitive !== undefined) {
        safe[key] = primitive;
      }
    }
  }

  return safe;
}

export function classifyPath(value: unknown): { kind: string; rel?: string } {
  if (value === null || value === undefined || value === "") {
    return { kind: "none" };
  }

  if (typeof value !== "string") {
    return { kind: "unknown" };
  }

  if (value.startsWith(pendingFilePathPrefix)) {
    return {
      kind: "pending",
      rel: safeRelativeIdentity(value.slice(pendingFilePathPrefix.length))
    };
  }

  if (value.startsWith(pendingDirectoryPathPrefix)) {
    return {
      kind: "pending",
      rel: safeRelativeIdentity(value.slice(pendingDirectoryPathPrefix.length))
    };
  }

  if (isAbsolutePath(value)) {
    return { kind: "real" };
  }

  const rel = safeRelativeIdentity(value);

  if (rel !== undefined) {
    return { kind: "relative", rel };
  }

  return { kind: "unknown" };
}

function persistReviewNavigationDiagnostic(event: string, details: Record<string, unknown>) {
  if (typeof window === "undefined" || !window.iliad?.diagnostics?.log) {
    return;
  }

  const safeDetails = safeReviewDiagnosticDetails(details);
  const navSeq = ++reviewNavigationSequence;

  try {
    void window.iliad.diagnostics
      .log({
        level: "info",
        area: "review",
        event: `review_navigation.${event}`,
        details: {
          ...safeDetails,
          navSeq
        }
      })
      .catch(() => undefined);
  } catch {
    // Diagnostics must never affect editor navigation.
  }
}

function addTargetDetails(target: Record<string, ReviewDiagnosticPrimitive>, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }

  const proposalId = safePrimitive((value as { proposalId?: unknown }).proposalId);
  const fileId = safePrimitive((value as { fileId?: unknown }).fileId);

  if (typeof proposalId === "string") {
    target.targetProposalId = proposalId;
  }

  if (typeof fileId === "string") {
    target.targetFileId = fileId;
  }
}

function addPathRelativeIdentity(
  target: Record<string, ReviewDiagnosticPrimitive>,
  key: string,
  classified: { kind: string; rel?: string }
) {
  if (!classified.rel) {
    return;
  }

  if (key === "selectedTreePath") {
    target.selectedTreeRel = classified.rel;
  }

  if (key === "revealPath") {
    target.revealRel = classified.rel;
  }

  if (key === "nodePath") {
    target.nodeRel = classified.rel;
  }
}

function safePrimitive(value: unknown): ReviewDiagnosticPrimitive | undefined {
  if (value === null || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string") {
    const clean = value.replace(/\s+/g, " ").trim();
    return clean || undefined;
  }

  return undefined;
}

function safeRelativeIdentity(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedInput = value.trim().replace(/\\/g, "/");

  if (!normalizedInput || isAbsolutePath(normalizedInput)) {
    return undefined;
  }

  const segments: string[] = [];

  for (const segment of normalizedInput.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      return undefined;
    }

    segments.push(segment);
  }

  return segments.length > 0 ? segments.join("/") : undefined;
}

function isAbsolutePath(value: string) {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}
