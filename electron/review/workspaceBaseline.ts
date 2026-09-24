import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { link, lstat, mkdir, open, readdir, readFile, rename, rm, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { buildLineReviewHunks, reconstructContent } from "./reviewDiff.js";
import { captureGitAdvisorySnapshot, checkGitAdvisorySnapshot, type GitAdvisorySnapshot } from "./gitAdvisory.js";
import { hashMarkdown } from "./hash.js";
import { ensureInsideWorkspace, isIgnoredWorkspaceName, markdownExtensions } from "../fs/pathSafety.js";
import { markWorkspaceMutation } from "../fs/workspaceMutationMarkers.js";
import {
  externalReviewFileId,
  externalReviewProposalId,
  projectExternalReview,
  terminalExternalReviewProposal,
  type ExternalReviewItem,
  type ExternalReviewSnapshot
} from "./externalReviewProjection.js";
import type { AgentChangeProposal } from "./types.js";

export type { ExternalReviewItem, ExternalReviewSnapshot } from "./externalReviewProjection.js";

export interface BaselineSubscriber {
  id: number;
  send(channel: string, payload: unknown): void;
  isDestroyed?(): boolean;
}

export type BaselineRecord =
  | { op: "set"; relativePath: string; content: string }
  | { op: "remove"; relativePath: string }
  | { op: "move"; fromRelativePath: string; toRelativePath: string; directory: boolean }
  | { op: "reconcile"; relativePath: string };

export type MarkdownWriteExpectation = { kind: "absent" } | { kind: "hash"; hash: string } | { kind: "any" };

export type MarkdownWriteConflictReason = "pending_review" | "disk_changed" | "unsafe_path";

export type MarkdownWriteResult =
  | { status: "written"; savedAt: string }
  | { status: "conflict"; reason: MarkdownWriteConflictReason };

export interface DiskChangeHint {
  relativePath: string | null;
  eventType: "change" | "rename" | "unknown";
}

export type ExternalReviewActionStatus = "applied" | "rejected" | "stale";

/** Returned by `restoreItem` when the path changed between the review's last look and the destructive step. */
const CHANGED_AGAIN_MESSAGE = "The file changed again outside Iliad; the review was refreshed.";

export interface ExternalReviewActionResult {
  status: ExternalReviewActionStatus;
  proposal: AgentChangeProposal;
  relativePath: string | null;
  kind: ExternalReviewItem["kind"] | null;
  content?: string;
  unrestored: Array<{ relativePath: string; reason: string }>;
  snapshot: ExternalReviewSnapshot;
}

export interface WorkspaceBaselineServiceOptions {
  trashItem?: (absolutePath: string) => Promise<void>;
  settleMs?: number;
  deferMs?: number;
  confirmMs?: number;
  releaseGraceMs?: number;
  onLog?: (event: string, details: Record<string, string | number | boolean | null>) => void;
  /**
   * Test seam: runs inside a guarded restore after the current file was moved
   * to its holding path and verified, just before the restored text is
   * published at the path.
   */
  beforeRestorePublish?: (absolutePath: string) => Promise<void> | void;
}

/** One chunk of an outside edit, exactly as the renderer saw it (spec V3). */
export interface ExternalReviewChunkRequest {
  fileId: string;
  chunkId: string;
  baselineHash: string;
  diskHash: string;
}

export const externalReviewChangedChannel = "agent:external-review-changed";

interface BaselineEntry {
  content: string;
  hash: string;
}

interface WorkspaceBaselineState {
  workspaceRoot: string;
  baseline: Map<string, BaselineEntry>;
  review: Map<string, ExternalReviewItem>;
  reviewRevision: number;
  gitSnapshot: GitAdvisorySnapshot;
  timer: NodeJS.Timeout | null;
  pendingPaths: Set<string> | null;
  refreshRequested: boolean;
  inFlight: Promise<void> | null;
  rerunRequested: boolean;
  mutationsInFlight: number;
  writeQueue: Promise<unknown>;
  subscribers: Map<number, BaselineSubscriber>;
  releaseTimer: NodeJS.Timeout | null;
  attaching: Promise<WorkspaceBaselineState> | null;
}

type DiskPathState =
  | { status: "present"; content: string }
  | { status: "absent" }
  | { status: "unsafe" };

const CONFLICT_ERROR_NAME = "MarkdownWriteConflict";

export class MarkdownWriteConflictError extends Error {
  constructor(readonly reason: MarkdownWriteConflictReason) {
    super(conflictMessage(reason));
    this.name = CONFLICT_ERROR_NAME;
  }
}

function conflictMessage(reason: MarkdownWriteConflictReason) {
  switch (reason) {
    case "pending_review":
      return "This file has outside changes waiting for review.";
    case "disk_changed":
      return "This file changed on disk since Iliad last read it.";
    default:
      return "This path is not a regular Markdown file inside the workspace.";
  }
}

/**
 * Owns the accepted Markdown state of every open workspace (the baseline), the
 * outside-change review derived from it, the single refresh loop that keeps
 * the review current, and the serialized compare-and-swap write primitive that
 * every accepted Markdown write goes through.
 */
export class WorkspaceBaselineService {
  private readonly states = new Map<string, WorkspaceBaselineState>();
  private readonly settleMs: number;
  private readonly deferMs: number;
  private readonly confirmMs: number;
  private readonly releaseGraceMs: number;
  private readonly trashItem: ((absolutePath: string) => Promise<void>) | null;
  private readonly onLog: WorkspaceBaselineServiceOptions["onLog"];
  private readonly beforeRestorePublish: WorkspaceBaselineServiceOptions["beforeRestorePublish"];
  private disposed = false;

  constructor(options: WorkspaceBaselineServiceOptions = {}) {
    this.settleMs = options.settleMs ?? 1200;
    this.deferMs = options.deferMs ?? 1000;
    this.confirmMs = options.confirmMs ?? 300;
    this.releaseGraceMs = options.releaseGraceMs ?? 5000;
    this.trashItem = options.trashItem ?? null;
    this.onLog = options.onLog;
    this.beforeRestorePublish = options.beforeRestorePublish;
  }

  async attach(workspaceRoot: string, subscriber: BaselineSubscriber): Promise<ExternalReviewSnapshot> {
    const key = path.resolve(workspaceRoot);
    let state = this.states.get(key);

    if (state?.attaching) {
      state = await state.attaching;
    }

    if (!state) {
      state = createState(key);
      this.states.set(key, state);
      state.attaching = this.initializeState(state).then(
        () => {
          state!.attaching = null;
          return state!;
        },
        (error) => {
          this.states.delete(key);
          throw error;
        }
      );
      state = await state.attaching;
      state.subscribers.set(subscriber.id, subscriber);
      this.publish(state, true);
      return this.currentReview(key);
    }

    if (state.releaseTimer) {
      clearTimeout(state.releaseTimer);
      state.releaseTimer = null;
    }

    const wasUnobserved = state.subscribers.size === 0;
    state.subscribers.set(subscriber.id, subscriber);

    if (wasUnobserved) {
      state.pendingPaths = null;
      await this.refresh(state);
    }

    this.publish(state, true);
    return this.currentReview(key);
  }

  detach(workspaceRoot: string, subscriberId: number) {
    const state = this.states.get(path.resolve(workspaceRoot));

    if (!state) {
      return;
    }

    state.subscribers.delete(subscriberId);

    if (state.subscribers.size > 0 || state.releaseTimer) {
      return;
    }

    state.releaseTimer = setTimeout(() => {
      state.releaseTimer = null;
      if (state.subscribers.size === 0) {
        this.dropState(state);
      }
    }, this.releaseGraceMs);
    state.releaseTimer.unref?.();
  }

  detachSubscriber(subscriberId: number) {
    for (const state of this.states.values()) {
      if (state.subscribers.has(subscriberId)) {
        this.detach(state.workspaceRoot, subscriberId);
      }
    }
  }

  hasWorkspace(workspaceRoot: string) {
    return this.states.has(path.resolve(workspaceRoot));
  }

  dispose() {
    this.disposed = true;
    for (const state of this.states.values()) {
      this.dropState(state);
    }
  }

  noteDiskChange(workspaceRoot: string, hint: DiskChangeHint) {
    const state = this.states.get(path.resolve(workspaceRoot));

    if (!state) {
      return;
    }

    const relativePath = hint.relativePath ? normalizeMarkdownRelativePath(hint.relativePath) : null;
    const scoped =
      hint.eventType === "change" &&
      relativePath !== null &&
      (state.baseline.has(relativePath) || state.review.has(relativePath));

    this.scheduleRefresh(state, scoped ? [relativePath as string] : null, this.settleMs);
  }

  noteWatcherRestarted(workspaceRoot: string) {
    const state = this.states.get(path.resolve(workspaceRoot));

    if (state) {
      this.scheduleRefresh(state, null, this.settleMs);
    }
  }

  isExternalProposalId(workspaceRoot: string, proposalId: string) {
    return proposalId === externalReviewProposalId(path.resolve(workspaceRoot));
  }

  currentReview(workspaceRoot: string): ExternalReviewSnapshot {
    const key = path.resolve(workspaceRoot);
    const state = this.states.get(key);

    if (!state) {
      return { workspaceRoot: key, revision: 0, proposal: null };
    }

    return {
      workspaceRoot: key,
      revision: state.reviewRevision,
      proposal: projectExternalReview(key, state.review.values(), state.reviewRevision)
    };
  }

  async refreshNow(workspaceRoot: string) {
    const state = this.states.get(path.resolve(workspaceRoot));

    if (state) {
      state.pendingPaths = null;
      await this.refresh(state);
    }
  }

  async runIliadMutation<T>(
    workspaceRoot: string,
    options: {
      paths: string[];
      operation: () => Promise<T>;
      record?: (result: T) => BaselineRecord[];
    }
  ): Promise<T> {
    const key = path.resolve(workspaceRoot);
    const state = this.states.get(key);
    const absolutePaths = options.paths.map((relativePath) => path.join(key, relativePath));
    markWorkspaceMutation(key, absolutePaths.length > 0 ? absolutePaths : undefined);

    if (!state) {
      try {
        return await options.operation();
      } finally {
        markWorkspaceMutation(key, absolutePaths.length > 0 ? absolutePaths : undefined);
      }
    }

    state.mutationsInFlight += 1;
    let records: BaselineRecord[] = [];
    let directoryMove = false;

    try {
      const result = await options.operation();
      records = options.record?.(result) ?? [];
      const reviewBefore = new Map(state.review);
      directoryMove = await this.applyRecords(state, records);

      // Structural records can move or drop pending items; the renderer must
      // hear about that now, not after the next disk event.
      if (!sameReview(reviewBefore, state.review)) {
        state.reviewRevision += 1;
        this.publish(state, false);
      }

      return result;
    } finally {
      state.mutationsInFlight -= 1;
      markWorkspaceMutation(key, absolutePaths.length > 0 ? absolutePaths : undefined);
      const touched = new Set(options.paths.map(normalizeMarkdownRelativePath).filter((value): value is string => value !== null));

      for (const record of records) {
        if (record.op === "move") {
          for (const value of [record.fromRelativePath, record.toRelativePath]) {
            const normalized = normalizeMarkdownRelativePath(value);
            if (normalized) {
              touched.add(normalized);
            }
          }
        } else {
          const normalized = normalizeMarkdownRelativePath(record.relativePath);
          if (normalized) {
            touched.add(normalized);
          }
        }
      }

      this.scheduleRefresh(state, directoryMove || touched.size === 0 ? null : [...touched], this.settleMs);
    }
  }

  hasPendingReview(workspaceRoot: string, relativePath: string): boolean {
    const state = this.states.get(path.resolve(workspaceRoot));
    const normalized = normalizeMarkdownRelativePath(relativePath);

    return Boolean(state && normalized && state.review.has(normalized));
  }

  async writeMarkdownIfUnchanged(
    workspaceRoot: string,
    request: { relativePath: string; content: string; expected: MarkdownWriteExpectation }
  ): Promise<MarkdownWriteResult> {
    const key = path.resolve(workspaceRoot);
    const state = this.states.get(key);

    return this.enqueueWrite(state, async () => {
      const relativePath = normalizeMarkdownRelativePath(request.relativePath);

      if (!relativePath) {
        return { status: "conflict", reason: "unsafe_path" };
      }

      if (state?.review.has(relativePath)) {
        return { status: "conflict", reason: "pending_review" };
      }

      const absolutePath = path.join(key, relativePath);
      const safety = await checkPathSafety(key, absolutePath);

      if (!safety.ok) {
        return { status: "conflict", reason: "unsafe_path" };
      }

      const current = await readDiskPathState(key, relativePath);

      if (current.status === "unsafe") {
        return { status: "conflict", reason: "unsafe_path" };
      }

      const expected = request.expected;

      if (expected.kind === "absent" && current.status !== "absent") {
        this.scheduleRefreshFor(state, relativePath);
        return { status: "conflict", reason: "disk_changed" };
      }

      if (expected.kind === "hash" && (current.status !== "present" || hashMarkdown(current.content) !== expected.hash)) {
        // The renderer's idea of disk is stale; make sure the review reflects
        // whatever is there now so the conflict has something to act on.
        this.scheduleRefreshFor(state, relativePath);
        return { status: "conflict", reason: "disk_changed" };
      }

      markWorkspaceMutation(key, [absolutePath]);

      try {
        await mkdir(path.dirname(absolutePath), { recursive: true });

        if (expected.kind === "absent") {
          await writeNoFollow(absolutePath, request.content, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL);
        } else if (expected.kind === "hash") {
          await writeNoFollow(absolutePath, request.content, fsConstants.O_RDWR);
        } else {
          await writeNoFollow(absolutePath, request.content, fsConstants.O_WRONLY | fsConstants.O_CREAT);
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;

        if (code === "EEXIST" || code === "ENOENT") {
          return { status: "conflict", reason: "disk_changed" };
        }

        throw error;
      } finally {
        markWorkspaceMutation(key, [absolutePath]);
      }

      if (state) {
        state.baseline.set(relativePath, { content: request.content, hash: hashMarkdown(request.content) });
      }

      return { status: "written", savedAt: new Date().toISOString() };
    });
  }

  async removeMarkdownIfUnchanged(
    workspaceRoot: string,
    request: { relativePath: string; expected: { kind: "hash"; hash: string } | { kind: "any" } }
  ): Promise<MarkdownWriteResult> {
    const key = path.resolve(workspaceRoot);
    const state = this.states.get(key);

    return this.enqueueWrite(state, async () => {
      const relativePath = normalizeMarkdownRelativePath(request.relativePath);

      if (!relativePath) {
        return { status: "conflict", reason: "unsafe_path" };
      }

      if (state?.review.has(relativePath)) {
        return { status: "conflict", reason: "pending_review" };
      }

      const absolutePath = path.join(key, relativePath);
      const safety = await checkPathSafety(key, absolutePath);

      if (!safety.ok) {
        return { status: "conflict", reason: "unsafe_path" };
      }

      const current = await readDiskPathState(key, relativePath);

      if (current.status === "unsafe") {
        return { status: "conflict", reason: "unsafe_path" };
      }

      if (current.status === "absent") {
        return { status: "conflict", reason: "disk_changed" };
      }

      if (request.expected.kind === "hash" && hashMarkdown(current.content) !== request.expected.hash) {
        return { status: "conflict", reason: "disk_changed" };
      }

      markWorkspaceMutation(key, [absolutePath]);

      try {
        await rm(absolutePath);
      } finally {
        markWorkspaceMutation(key, [absolutePath]);
      }

      state?.baseline.delete(relativePath);
      return { status: "written", savedAt: new Date().toISOString() };
    });
  }

  async keep(workspaceRoot: string, fileId: string): Promise<ExternalReviewActionResult> {
    const state = this.requireState(workspaceRoot);

    return this.enqueueWrite(state, async () => {
      const before = this.currentReview(state.workspaceRoot);
      const located = await this.locateReviewItem(state, fileId);

      if (!located) {
        return this.staleResult(state, before, fileId);
      }

      const { item } = located;

      if (item.kind === "delete") {
        state.baseline.delete(item.relativePath);
      } else {
        const content = item.diskContent ?? "";
        state.baseline.set(item.relativePath, { content, hash: item.diskHash ?? hashMarkdown(content) });
      }

      state.review.delete(item.relativePath);
      await this.finishReviewChange(state, [item.relativePath]);

      return {
        status: "applied",
        proposal: terminalExternalReviewProposal(before.proposal ?? emptyProposal(state.workspaceRoot), fileId, "applied"),
        relativePath: item.relativePath,
        kind: item.kind,
        content: item.kind === "delete" ? undefined : item.diskContent ?? "",
        unrestored: [],
        snapshot: this.currentReview(state.workspaceRoot)
      };
    });
  }

  async restore(workspaceRoot: string, fileId: string): Promise<ExternalReviewActionResult> {
    const state = this.requireState(workspaceRoot);

    return this.enqueueWrite(state, async () => {
      const before = this.currentReview(state.workspaceRoot);
      const located = await this.locateReviewItem(state, fileId);

      if (!located) {
        return this.staleResult(state, before, fileId);
      }

      await this.ensureDestructiveWriteAllowed(state);
      const failure = await this.restoreItem(state, located.item);

      if (failure === CHANGED_AGAIN_MESSAGE) {
        // Nothing was written; the newer outside content is what the
        // refreshed review shows. A notice, not an error.
        state.pendingPaths = null;
        await this.refresh(state);
        return this.staleResult(state, before, fileId);
      }

      if (failure) {
        throw new Error(failure);
      }

      state.review.delete(located.item.relativePath);
      await this.finishReviewChange(state, [located.item.relativePath]);

      return {
        status: "rejected",
        proposal: terminalExternalReviewProposal(before.proposal ?? emptyProposal(state.workspaceRoot), fileId, "rejected"),
        relativePath: located.item.relativePath,
        kind: located.item.kind,
        unrestored: [],
        snapshot: this.currentReview(state.workspaceRoot)
      };
    });
  }

  async restoreAll(workspaceRoot: string): Promise<ExternalReviewActionResult> {
    const state = this.requireState(workspaceRoot);

    return this.enqueueWrite(state, async () => {
      const before = this.currentReview(state.workspaceRoot);
      const items = [...state.review.values()];

      if (items.length === 0) {
        // The caller acted on items that are already gone (another window
        // or action resolved them first): report stale, never a silent
        // success.
        state.pendingPaths = null;
        await this.refresh(state);
        return this.staleResult(state, before, null);
      }

      const validated: ExternalReviewItem[] = [];
      let drifted = false;

      for (const item of items) {
        const current = await readDiskPathState(state.workspaceRoot, item.relativePath);

        if (itemMatchesDisk(item, current)) {
          validated.push(item);
        } else {
          drifted = true;
        }
      }

      if (drifted) {
        state.pendingPaths = null;
        await this.refresh(state);
        return this.staleResult(state, before, null);
      }

      await this.ensureDestructiveWriteAllowed(state);
      const unrestored: Array<{ relativePath: string; reason: string }> = [];
      let changedAgain = false;

      for (const item of validated) {
        const failure = await this.restoreItem(state, item);

        if (failure === CHANGED_AGAIN_MESSAGE) {
          // Left on disk; the refreshed review shows the newer version.
          changedAgain = true;
        } else if (failure) {
          unrestored.push({ relativePath: item.relativePath, reason: failure });
        } else {
          state.review.delete(item.relativePath);
        }
      }

      await this.finishReviewChange(
        state,
        validated.map((item) => item.relativePath)
      );

      const outcome = unrestored.length > 0 || changedAgain ? "stale" : "rejected";

      return {
        status: outcome,
        proposal: terminalExternalReviewProposal(
          before.proposal ?? emptyProposal(state.workspaceRoot),
          null,
          changedAgain && unrestored.length === 0 ? "stale" : "rejected"
        ),
        relativePath: null,
        kind: null,
        unrestored,
        snapshot: this.currentReview(state.workspaceRoot)
      };
    });
  }

  /**
   * Keep one chunk of an outside edit: the baseline takes that chunk (no disk
   * write). The item disappears once the baseline equals disk.
   */
  async keepChunk(workspaceRoot: string, request: ExternalReviewChunkRequest): Promise<ExternalReviewActionResult> {
    const state = this.requireState(workspaceRoot);

    return this.enqueueWrite(state, async () => {
      const before = this.currentReview(state.workspaceRoot);
      const located = await this.locateReviewChunk(state, request);

      if (!located) {
        return this.staleResult(state, before, request.fileId);
      }

      const { item, chunk } = located;
      const content = reconstructContent(item.baselineContent ?? "", [{ ...chunk, status: "accepted" }]);
      state.baseline.set(item.relativePath, { content, hash: hashMarkdown(content) });
      await this.finishReviewChange(state, [item.relativePath]);

      return {
        status: "applied",
        proposal: before.proposal ?? emptyProposal(state.workspaceRoot),
        relativePath: item.relativePath,
        kind: item.kind,
        content: item.diskContent ?? "",
        unrestored: [],
        snapshot: this.currentReview(state.workspaceRoot)
      };
    });
  }

  /**
   * Restore one chunk of an outside edit: disk becomes the outside version
   * without that chunk, through the guarded replacement. Baseline unchanged.
   */
  async restoreChunk(workspaceRoot: string, request: ExternalReviewChunkRequest): Promise<ExternalReviewActionResult> {
    const state = this.requireState(workspaceRoot);

    return this.enqueueWrite(state, async () => {
      const before = this.currentReview(state.workspaceRoot);
      const located = await this.locateReviewChunk(state, request);

      if (!located) {
        return this.staleResult(state, before, request.fileId);
      }

      const { item, hunks, chunk } = located;
      const baselineContent = item.baselineContent ?? "";
      const allAccepted = hunks.map((hunk) => ({ ...hunk, status: "accepted" as const }));

      if (reconstructContent(baselineContent, allAccepted) !== (item.diskContent ?? "")) {
        throw new Error("The outside change could not be split into chunks safely.");
      }

      const content = reconstructContent(
        baselineContent,
        hunks.map((hunk) => ({ ...hunk, status: hunk.id === chunk.id ? ("rejected" as const) : ("accepted" as const) }))
      );

      await this.ensureDestructiveWriteAllowed(state);
      const failure = await this.restoreItem(state, item, content);

      if (failure === CHANGED_AGAIN_MESSAGE) {
        state.pendingPaths = null;
        await this.refresh(state);
        return this.staleResult(state, before, request.fileId);
      }

      if (failure) {
        throw new Error(failure);
      }

      await this.finishReviewChange(state, [item.relativePath]);

      return {
        status: "rejected",
        proposal: before.proposal ?? emptyProposal(state.workspaceRoot),
        relativePath: item.relativePath,
        kind: item.kind,
        content,
        unrestored: [],
        snapshot: this.currentReview(state.workspaceRoot)
      };
    });
  }

  // ---------------------------------------------------------------------------
  // internals

  private async initializeState(state: WorkspaceBaselineState) {
    const disk = await scanMarkdownWorkspace(state.workspaceRoot);

    for (const [relativePath, content] of disk) {
      state.baseline.set(relativePath, { content, hash: hashMarkdown(content) });
    }

    state.gitSnapshot = await captureGitAdvisorySnapshot(state.workspaceRoot);
    this.log("baseline.attached", { fileCount: state.baseline.size, gitStatus: state.gitSnapshot.status });
  }

  private dropState(state: WorkspaceBaselineState) {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    if (state.releaseTimer) {
      clearTimeout(state.releaseTimer);
      state.releaseTimer = null;
    }

    this.states.delete(state.workspaceRoot);
  }

  private requireState(workspaceRoot: string) {
    const state = this.states.get(path.resolve(workspaceRoot));

    if (!state) {
      throw new Error("No outside changes are pending review.");
    }

    return state;
  }

  private scheduleRefreshFor(state: WorkspaceBaselineState | undefined, relativePath: string) {
    if (state) {
      this.scheduleRefresh(state, [relativePath], 0);
    }
  }

  private scheduleRefresh(state: WorkspaceBaselineState, relativePaths: string[] | null, delayMs: number) {
    if (this.disposed) {
      return;
    }

    if (relativePaths === null) {
      state.pendingPaths = null;
    } else if (state.pendingPaths !== null || !state.refreshRequested) {
      state.pendingPaths = state.pendingPaths ?? new Set();
      for (const relativePath of relativePaths) {
        state.pendingPaths.add(relativePath);
      }
    }

    state.refreshRequested = true;

    if (state.timer) {
      clearTimeout(state.timer);
    }

    state.timer = setTimeout(() => {
      state.timer = null;

      if (state.mutationsInFlight > 0) {
        state.timer = setTimeout(() => {
          state.timer = null;
          this.scheduleRefresh(state, state.pendingPaths ? [...state.pendingPaths] : null, 0);
        }, this.deferMs);
        state.timer.unref?.();
        return;
      }

      void this.refresh(state).catch((error) => {
        this.log("baseline.refresh_failed", { message: errorMessage(error) });
      });
    }, delayMs);
    state.timer.unref?.();
  }

  private refresh(state: WorkspaceBaselineState): Promise<void> {
    if (state.inFlight) {
      state.rerunRequested = true;
      return state.inFlight;
    }

    const run = (async () => {
      do {
        state.rerunRequested = false;
        const scope = state.refreshRequested || state.pendingPaths === null ? state.pendingPaths : new Set<string>();
        state.pendingPaths = new Set();
        state.refreshRequested = false;

        try {
          await this.refreshOnce(state, scope);
        } catch (error) {
          this.log("baseline.refresh_failed", { message: errorMessage(error) });
        }
      } while (state.rerunRequested && !this.disposed);
    })();

    state.inFlight = run.finally(() => {
      state.inFlight = null;
    });

    return state.inFlight;
  }

  private async refreshOnce(state: WorkspaceBaselineState, scope: Set<string> | null) {
    const nextReview = new Map(state.review);

    if (scope !== null) {
      let escalate = false;

      for (const relativePath of scope) {
        const current = await readDiskPathState(state.workspaceRoot, relativePath);

        if (current.status === "unsafe") {
          escalate = true;
          break;
        }

        const item = classify(state, relativePath, current);

        if (item) {
          nextReview.set(relativePath, item);
        } else {
          nextReview.delete(relativePath);
        }
      }

      if (!escalate) {
        await this.confirmLifecycleItems(state, nextReview, scope);
        this.commitReview(state, nextReview);
        return;
      }
    }

    const disk = await scanMarkdownWorkspace(state.workspaceRoot);
    const fullReview = new Map<string, ExternalReviewItem>();

    for (const [relativePath, content] of disk) {
      const item = classify(state, relativePath, { status: "present", content });
      if (item) {
        fullReview.set(relativePath, item);
      }
    }

    for (const relativePath of state.baseline.keys()) {
      if (!disk.has(relativePath)) {
        const item = classify(state, relativePath, { status: "absent" });
        if (item) {
          fullReview.set(relativePath, item);
        }
      }
    }

    await this.confirmLifecycleItems(state, fullReview, null);
    this.commitReview(state, fullReview);
  }

  /** Create and delete items must survive a second observation before publishing. */
  private async confirmLifecycleItems(
    state: WorkspaceBaselineState,
    nextReview: Map<string, ExternalReviewItem>,
    scope: Set<string> | null
  ) {
    const candidates = [...nextReview.values()].filter(
      (item) =>
        (item.kind === "create" || item.kind === "delete") &&
        (scope === null || scope.has(item.relativePath)) &&
        state.review.get(item.relativePath)?.kind !== item.kind
    );

    if (candidates.length === 0) {
      return;
    }

    await sleep(this.confirmMs);

    for (const candidate of candidates) {
      const current = await readDiskPathState(state.workspaceRoot, candidate.relativePath);
      const confirmed = classify(state, candidate.relativePath, current);

      if (!confirmed) {
        nextReview.delete(candidate.relativePath);
      } else {
        // The second observation is the published one, so content that
        // changed inside the confirmation window is not shown stale.
        nextReview.set(candidate.relativePath, confirmed);
      }
    }
  }

  private commitReview(state: WorkspaceBaselineState, nextReview: Map<string, ExternalReviewItem>) {
    const changed = !sameReview(state.review, nextReview);
    state.review = nextReview;

    if (!changed) {
      return;
    }

    state.reviewRevision += 1;
    void captureGitAdvisorySnapshot(state.workspaceRoot).then((snapshot) => {
      state.gitSnapshot = snapshot;
    });
    this.log("baseline.review_changed", {
      revision: state.reviewRevision,
      itemCount: nextReview.size,
      editCount: [...nextReview.values()].filter((item) => item.kind === "edit").length,
      createCount: [...nextReview.values()].filter((item) => item.kind === "create").length,
      deleteCount: [...nextReview.values()].filter((item) => item.kind === "delete").length
    });
    this.publish(state, false);
  }

  private publish(state: WorkspaceBaselineState, force: boolean) {
    if (!force && state.subscribers.size === 0) {
      return;
    }

    const snapshot = this.currentReview(state.workspaceRoot);

    for (const subscriber of state.subscribers.values()) {
      if (subscriber.isDestroyed?.()) {
        state.subscribers.delete(subscriber.id);
        continue;
      }

      try {
        subscriber.send(externalReviewChangedChannel, snapshot);
      } catch (error) {
        this.log("baseline.publish_failed", { message: errorMessage(error) });
      }
    }
  }

  private async applyRecords(state: WorkspaceBaselineState, records: BaselineRecord[]) {
    let directoryMove = false;

    for (const record of records) {
      if (record.op === "set") {
        const relativePath = normalizeMarkdownRelativePath(record.relativePath);
        if (relativePath) {
          state.baseline.set(relativePath, { content: record.content, hash: hashMarkdown(record.content) });
          state.review.delete(relativePath);
        }
        continue;
      }

      if (record.op === "remove") {
        const relativePath = normalizePosixRelativePath(record.relativePath);
        if (relativePath) {
          removePrefix(state.baseline, relativePath);
          removePrefix(state.review, relativePath);
        }
        continue;
      }

      if (record.op === "reconcile") {
        const relativePath = normalizeMarkdownRelativePath(record.relativePath);
        if (relativePath) {
          const current = await readDiskPathState(state.workspaceRoot, relativePath);
          if (current.status === "present") {
            state.baseline.set(relativePath, { content: current.content, hash: hashMarkdown(current.content) });
          } else {
            state.baseline.delete(relativePath);
          }
          state.review.delete(relativePath);
        }
        continue;
      }

      const from = normalizePosixRelativePath(record.fromRelativePath);
      const to = normalizePosixRelativePath(record.toRelativePath);

      if (!from || !to) {
        continue;
      }

      if (record.directory) {
        directoryMove = true;
        movePrefix(state.baseline, from, to);
        movePrefix(state.review, from, to, (item, relativePath) => ({ ...item, relativePath }));
      } else {
        const entry = state.baseline.get(from);
        state.baseline.delete(from);
        if (entry && normalizeMarkdownRelativePath(to)) {
          state.baseline.set(to, entry);
        }

        const item = state.review.get(from);
        state.review.delete(from);
        if (item && normalizeMarkdownRelativePath(to)) {
          state.review.set(to, { ...item, relativePath: to });
        }
      }
    }

    return directoryMove;
  }

  /**
   * An action is valid only when the item the renderer was shown (the last
   * published one) still describes what is on disk. If the file changed
   * again outside, the review is refreshed and the action is reported stale;
   * acting on the refreshed item would destroy content nobody reviewed.
   */
  private async locateReviewItem(state: WorkspaceBaselineState, fileId: string) {
    const item = [...state.review.values()].find((candidate) => externalReviewFileId(candidate.relativePath) === fileId);

    if (item) {
      const current = await readDiskPathState(state.workspaceRoot, item.relativePath);

      if (current.status === "unsafe") {
        throw new Error("The reviewed path changed into an unsafe file type outside Iliad.");
      }

      if (itemMatchesDisk(item, current)) {
        return { item };
      }
    }

    state.pendingPaths = null;
    await this.refresh(state);
    return null;
  }

  /**
   * A chunk action is valid only when the item still carries exactly the
   * baseline and disk the renderer saw (chunk ids are positional, spec V3).
   */
  private async locateReviewChunk(state: WorkspaceBaselineState, request: ExternalReviewChunkRequest) {
    const located = await this.locateReviewItem(state, request.fileId);

    if (!located) {
      return null;
    }

    const { item } = located;

    if (item.kind === "edit" && item.baselineHash === request.baselineHash && item.diskHash === request.diskHash) {
      const hunks = buildLineReviewHunks(item.baselineContent ?? "", item.diskContent ?? "", request.fileId);
      const chunk = hunks.find((candidate) => candidate.id === request.chunkId);

      if (chunk) {
        return { item, hunks, chunk };
      }
    }

    state.pendingPaths = null;
    await this.refresh(state);
    return null;
  }

  private staleResult(
    state: WorkspaceBaselineState,
    before: ExternalReviewSnapshot,
    fileId: string | null
  ): ExternalReviewActionResult {
    return {
      status: "stale",
      proposal: terminalExternalReviewProposal(before.proposal ?? emptyProposal(state.workspaceRoot), fileId, "stale"),
      relativePath: null,
      kind: null,
      unrestored: [],
      snapshot: this.currentReview(state.workspaceRoot)
    };
  }

  /**
   * Returns disk to `content` (default: the baseline) for one reviewed item.
   * Never writes over bytes nobody reviewed: edits go through the guarded
   * replacement, a deleted file is recreated exclusively, and a created file
   * is moved to the Trash from a holding path.
   */
  private async restoreItem(state: WorkspaceBaselineState, item: ExternalReviewItem, content?: string): Promise<string | null> {
    const absolutePath = path.join(state.workspaceRoot, item.relativePath);
    const safety = await checkPathSafety(state.workspaceRoot, absolutePath);

    if (!safety.ok) {
      return safety.error;
    }

    // Last look before the destructive step: the item must still describe
    // what is on disk, or the newest outside content would be lost.
    const current = await readDiskPathState(state.workspaceRoot, item.relativePath);

    if (!itemMatchesDisk(item, current)) {
      return CHANGED_AGAIN_MESSAGE;
    }

    markWorkspaceMutation(state.workspaceRoot, [absolutePath]);

    try {
      if (item.kind === "create") {
        if (!this.trashItem) {
          return "Moving files to the Trash is unavailable in this environment.";
        }

        return await this.trashReviewedFile(state, item, absolutePath);
      }

      if (item.kind === "delete") {
        await mkdir(path.dirname(absolutePath), { recursive: true });

        try {
          // Exclusive create: a file that appeared meanwhile is never replaced.
          await writeNoFollow(
            absolutePath,
            content ?? item.baselineContent ?? "",
            fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            return CHANGED_AGAIN_MESSAGE;
          }

          throw error;
        }

        return null;
      }

      return await this.replaceReviewedFile(absolutePath, item.diskHash ?? "", content ?? item.baselineContent ?? "");
    } catch (error) {
      return errorMessage(error);
    } finally {
      markWorkspaceMutation(state.workspaceRoot, [absolutePath]);
    }
  }

  /**
   * Guarded replacement (spec V4). The current file is renamed (atomically)
   * to a hidden holding path so no writer can change it underneath; its bytes
   * must hash to the reviewed disk hash. The new text is written to a temp
   * file in the same folder and published with a hard link, which fails if
   * anything appeared at the path meanwhile. Every failure keeps the newer
   * file untouched and the held bytes recoverable, and reports "changed again".
   */
  private async replaceReviewedFile(absolutePath: string, expectedHash: string, content: string): Promise<string | null> {
    const directory = path.dirname(absolutePath);
    const token = randomUUID();
    const holdingDirectory = path.join(directory, `.iliad-restore-${token}`);
    const held = path.join(holdingDirectory, path.basename(absolutePath));
    const temp = path.join(directory, `.iliad-restore-${token}.tmp`);
    await mkdir(holdingDirectory);

    try {
      await rename(absolutePath, held);
    } catch (error) {
      await rmdir(holdingDirectory).catch(() => undefined);

      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return CHANGED_AGAIN_MESSAGE;
      }

      throw error;
    }

    let heldContent: string | null = null;
    let heldMode = 0o644;

    try {
      const stats = await lstat(held);

      if (stats.isFile() && !stats.isSymbolicLink()) {
        heldMode = stats.mode & 0o777;
        heldContent = await readFile(held, "utf8");
      }
    } catch {
      heldContent = null;
    }

    if (heldContent === null || hashMarkdown(heldContent) !== expectedHash) {
      await this.returnHeldFile(held, absolutePath);
      await rmdir(holdingDirectory).catch(() => undefined);
      return CHANGED_AGAIN_MESSAGE;
    }

    try {
      await writeNoFollow(temp, content, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, heldMode);
      await this.beforeRestorePublish?.(absolutePath);
      // No-clobber publish: `link` fails with EEXIST if a file took the path.
      await link(temp, absolutePath);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      await this.returnHeldFile(held, absolutePath);
      await rmdir(holdingDirectory).catch(() => undefined);

      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return CHANGED_AGAIN_MESSAGE;
      }

      throw error;
    }

    await rm(temp, { force: true }).catch(() => undefined);
    await rm(held, { force: true }).catch(() => undefined);
    await rmdir(holdingDirectory).catch(() => undefined);
    return null;
  }

  /**
   * Move an outside-created file to the Trash without a window in which a
   * newer outside write could be discarded unreviewed.
   *
   * The file is first renamed (atomically) into a hidden sibling folder, so
   * any writer that opens the path afterwards creates a new file there and
   * never touches the held one; the held content is then verified against
   * the reviewed hash before it goes to the Trash. The hidden folder keeps
   * the original basename, so the Trash entry reads as the user expects.
   */
  private async trashReviewedFile(state: WorkspaceBaselineState, item: ExternalReviewItem, absolutePath: string) {
    const directory = path.dirname(absolutePath);
    const holdingDirectory = path.join(directory, `.iliad-restore-${randomUUID()}`);
    const held = path.join(holdingDirectory, path.basename(absolutePath));
    await mkdir(holdingDirectory);

    try {
      await rename(absolutePath, held);
    } catch (error) {
      await rmdir(holdingDirectory).catch(() => undefined);
      throw error;
    }

    let heldContent: string | null = null;

    try {
      const stats = await lstat(held);
      heldContent = stats.isFile() && !stats.isSymbolicLink() ? await readFile(held, "utf8") : null;
    } catch {
      heldContent = null;
    }

    if (heldContent === null || hashMarkdown(heldContent) !== item.diskHash) {
      // The file changed between the review's last look and the move. Put it
      // back untouched; if a newer file already took the path, keep this
      // version beside it so nothing is lost and both are reviewable.
      await this.returnHeldFile(held, absolutePath);
      await rmdir(holdingDirectory).catch(() => undefined);
      return CHANGED_AGAIN_MESSAGE;
    }

    try {
      await this.trashItem!(held);
    } catch (error) {
      await this.returnHeldFile(held, absolutePath);
      await rmdir(holdingDirectory).catch(() => undefined);
      throw error;
    }

    await rmdir(holdingDirectory).catch(() => undefined);
    await removeEmptyAncestors(directory, state.workspaceRoot);
    return null;
  }

  private async returnHeldFile(held: string, absolutePath: string) {
    try {
      // `link` refuses to replace a file that appeared at the path meanwhile.
      await link(held, absolutePath);
      await unlink(held);
      return;
    } catch {
      // fall through
    }

    const parsed = path.parse(absolutePath);
    const sibling = path.join(parsed.dir, `${parsed.name} (outside copy ${Date.now()})${parsed.ext}`);
    await rename(held, sibling).catch(() => undefined);
  }

  private async finishReviewChange(state: WorkspaceBaselineState, relativePaths: string[]) {
    state.reviewRevision += 1;
    state.pendingPaths = new Set(relativePaths);
    state.refreshRequested = true;
    await this.refresh(state);
    state.gitSnapshot = await captureGitAdvisorySnapshot(state.workspaceRoot);
    this.publish(state, false);
  }

  private async ensureDestructiveWriteAllowed(state: WorkspaceBaselineState) {
    const check = await checkGitAdvisorySnapshot(state.workspaceRoot, state.gitSnapshot);

    if (check.status === "head_changed") {
      state.pendingPaths = null;
      await this.refresh(state);
      state.gitSnapshot = await captureGitAdvisorySnapshot(state.workspaceRoot);
      this.publish(state, false);
      throw new Error("Repository changed outside Iliad; the outside changes were refreshed. Try again.");
    }

    if (check.status === "unsafe") {
      throw new Error("Repository state could not be checked before restoring outside changes.");
    }
  }

  private enqueueWrite<T>(state: WorkspaceBaselineState | undefined, operation: () => Promise<T>): Promise<T> {
    if (!state) {
      return operation();
    }

    const next = state.writeQueue.then(operation, operation);
    state.writeQueue = next.catch(() => undefined);
    return next;
  }

  private log(event: string, details: Record<string, string | number | boolean | null>) {
    this.onLog?.(event, details);
  }
}

// -----------------------------------------------------------------------------
// helpers

function createState(workspaceRoot: string): WorkspaceBaselineState {
  return {
    workspaceRoot,
    baseline: new Map(),
    review: new Map(),
    reviewRevision: 0,
    gitSnapshot: { status: "unavailable", reason: "not_repo" },
    timer: null,
    pendingPaths: null,
    refreshRequested: false,
    inFlight: null,
    rerunRequested: false,
    mutationsInFlight: 0,
    writeQueue: Promise.resolve(),
    subscribers: new Map(),
    releaseTimer: null,
    attaching: null
  };
}

function emptyProposal(workspaceRoot: string): AgentChangeProposal {
  const now = new Date().toISOString();
  return {
    id: externalReviewProposalId(workspaceRoot),
    runId: `external-filesystem`,
    workspaceRoot,
    title: "Outside changes",
    summary: "",
    createdAt: now,
    updatedAt: now,
    model: "external-filesystem",
    source: { kind: "external_agent" },
    metadata: {
      kind: "external_filesystem",
      baselineId: "baseline-0",
      snapshotId: "snapshot-0",
      revision: 0,
      liveDisk: true,
      sessionScoped: true
    },
    status: "pending",
    files: []
  };
}

function classify(
  state: WorkspaceBaselineState,
  relativePath: string,
  current: DiskPathState
): ExternalReviewItem | null {
  const baseline = state.baseline.get(relativePath);

  if (current.status === "unsafe") {
    return null;
  }

  if (!baseline) {
    if (current.status === "absent") {
      return null;
    }

    return {
      relativePath,
      kind: "create",
      baselineContent: null,
      baselineHash: null,
      diskContent: current.content,
      diskHash: hashMarkdown(current.content)
    };
  }

  if (current.status === "absent") {
    return {
      relativePath,
      kind: "delete",
      baselineContent: baseline.content,
      baselineHash: baseline.hash,
      diskContent: null,
      diskHash: null
    };
  }

  if (current.content === baseline.content) {
    return null;
  }

  return {
    relativePath,
    kind: "edit",
    baselineContent: baseline.content,
    baselineHash: baseline.hash,
    diskContent: current.content,
    diskHash: hashMarkdown(current.content)
  };
}

function itemMatchesDisk(item: ExternalReviewItem, current: DiskPathState) {
  if (current.status === "unsafe") {
    return false;
  }

  if (item.kind === "delete") {
    return current.status === "absent";
  }

  return current.status === "present" && hashMarkdown(current.content) === item.diskHash;
}

function sameReview(left: Map<string, ExternalReviewItem>, right: Map<string, ExternalReviewItem>) {
  if (left.size !== right.size) {
    return false;
  }

  for (const [relativePath, item] of left) {
    const other = right.get(relativePath);

    if (
      !other ||
      other.kind !== item.kind ||
      other.baselineHash !== item.baselineHash ||
      other.diskHash !== item.diskHash
    ) {
      return false;
    }
  }

  return true;
}

function removePrefix<T>(map: Map<string, T>, prefix: string) {
  for (const key of [...map.keys()]) {
    if (key === prefix || key.startsWith(`${prefix}/`)) {
      map.delete(key);
    }
  }
}

function movePrefix<T>(map: Map<string, T>, from: string, to: string, rekey?: (value: T, relativePath: string) => T) {
  for (const [key, value] of [...map.entries()]) {
    if (key !== from && !key.startsWith(`${from}/`)) {
      continue;
    }

    map.delete(key);
    const nextKey = `${to}${key.slice(from.length)}`;

    if (normalizeMarkdownRelativePath(nextKey)) {
      map.set(nextKey, rekey ? rekey(value, nextKey) : value);
    }
  }
}

/**
 * Writes through a descriptor opened with O_NOFOLLOW so a symlink swapped in
 * between the safety check and the write fails (ELOOP) instead of being
 * followed outside the workspace.
 */
async function writeNoFollow(absolutePath: string, content: string, flags: number, mode = 0o644) {
  const noFollow = typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0;
  const handle = await open(absolutePath, flags | noFollow, mode);

  try {
    await handle.truncate(0);
    await handle.write(content, 0, "utf8");
  } finally {
    await handle.close();
  }
}

async function checkPathSafety(
  workspaceRoot: string,
  absolutePath: string
): Promise<{ ok: true } | { ok: false; error: string; directory?: boolean }> {
  try {
    ensureInsideWorkspace(workspaceRoot, absolutePath);
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }

  const root = path.resolve(workspaceRoot);
  const ancestors: string[] = [];
  let current = path.dirname(path.resolve(absolutePath));

  while (current !== root) {
    if (path.relative(root, current).startsWith("..")) {
      return { ok: false, error: "Path is outside the workspace." };
    }

    ancestors.push(current);
    current = path.dirname(current);
  }

  for (const ancestor of ancestors.reverse()) {
    try {
      const stats = await lstat(ancestor);

      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        return { ok: false, error: "A folder on the path is not a regular folder." };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: true };
      }

      return { ok: false, error: errorMessage(error) };
    }
  }

  try {
    const stats = await lstat(absolutePath);

    if (stats.isSymbolicLink() || !stats.isFile()) {
      return {
        ok: false,
        error: stats.isDirectory() && !stats.isSymbolicLink() ? "A folder has taken this file's name." : "The target is not a regular file.",
        directory: stats.isDirectory() && !stats.isSymbolicLink()
      };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return { ok: false, error: errorMessage(error) };
    }
  }

  return { ok: true };
}

export async function readDiskPathState(workspaceRoot: string, relativePath: string): Promise<DiskPathState> {
  const absolutePath = path.join(workspaceRoot, relativePath);
  const safety = await checkPathSafety(workspaceRoot, absolutePath);

  if (!safety.ok) {
    // A folder took the file's name: for the Markdown review the file is
    // gone (a delete item whose restore is refused visibly), and any Markdown
    // inside the folder is scanned as new files.
    return safety.directory ? { status: "absent" } : { status: "unsafe" };
  }

  try {
    const stats = await lstat(absolutePath);

    if (stats.isSymbolicLink() || !stats.isFile()) {
      return { status: "unsafe" };
    }

    return { status: "present", content: await readFile(absolutePath, "utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "absent" };
    }

    return { status: "unsafe" };
  }
}

export async function scanMarkdownWorkspace(workspaceRoot: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  await scanDirectory(path.resolve(workspaceRoot), path.resolve(workspaceRoot), files);
  return files;
}

async function scanDirectory(workspaceRoot: string, directoryPath: string, files: Map<string, string>) {
  let entries;

  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (isIgnoredWorkspaceName(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directoryPath, entry.name);
    let stats;

    try {
      stats = await lstat(absolutePath);
    } catch {
      continue;
    }

    if (stats.isSymbolicLink()) {
      continue;
    }

    if (stats.isDirectory()) {
      await scanDirectory(workspaceRoot, absolutePath, files);
      continue;
    }

    if (!stats.isFile() || !markdownExtensions.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }

    const relativePath = normalizeMarkdownRelativePath(path.relative(workspaceRoot, absolutePath));

    if (!relativePath) {
      continue;
    }

    try {
      files.set(relativePath, await readFile(absolutePath, "utf8"));
    } catch {
      continue;
    }
  }
}

async function removeEmptyAncestors(directoryPath: string, workspaceRoot: string) {
  let currentPath = path.resolve(directoryPath);
  const root = path.resolve(workspaceRoot);

  while (currentPath !== root && !path.relative(root, currentPath).startsWith("..")) {
    try {
      await rmdir(currentPath);
    } catch {
      return;
    }

    currentPath = path.dirname(currentPath);
  }
}

export function normalizePosixRelativePath(rawPath: string): string | null {
  const trimmed = rawPath.replace(/\\/g, "/");

  if (!trimmed) {
    return null;
  }

  const normalized = path.posix.normalize(trimmed).replace(/^\.\//, "").replace(/\/$/, "");

  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    return null;
  }

  const segments = normalized.split("/");

  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))) {
    return null;
  }

  return normalized;
}

export function normalizeMarkdownRelativePath(rawPath: string): string | null {
  const normalized = normalizePosixRelativePath(rawPath);

  if (!normalized || !markdownExtensions.has(path.posix.extname(normalized).toLowerCase())) {
    return null;
  }

  return normalized;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
