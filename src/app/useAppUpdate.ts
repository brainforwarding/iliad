import { useCallback, useEffect, useRef, useState } from "react";
import type { AppUpdateState, UpdatePrepareMode, UpdatePrepareResponse } from "../types/iliad";

export interface PrepareForUpdateRestartOptions {
  mode: UpdatePrepareMode;
  /** Saves the open document and pending comment writes; rejects when either fails. */
  flushSave: () => Promise<void>;
  /** An outside-change review is pending in this window (restarting ends it). */
  hasPendingReview: () => boolean;
  /** Shows the confirmation; resolves true for Restart. */
  confirm: () => Promise<boolean>;
  /** Tells main the writer is deciding, so it doesn't time this window out. */
  waitingForWriter: () => void;
  onSaveFailed: (error: unknown) => void;
}

/**
 * This window's answer before Iliad quits for an update (spec 2026-09-27):
 * save first — a failed save cancels — then, for a restart (not a normal
 * Quit, which ends reviews anyway), confirm a pending outside-change review.
 */
export async function prepareForUpdateRestart({
  mode,
  flushSave,
  hasPendingReview,
  confirm,
  waitingForWriter,
  onSaveFailed
}: PrepareForUpdateRestartOptions): Promise<UpdatePrepareResponse> {
  try {
    await flushSave();
  } catch (error) {
    onSaveFailed(error);
    return { ok: false, reason: "save-failed" };
  }

  if (mode === "restart" && hasPendingReview()) {
    waitingForWriter();

    if (!(await confirm())) {
      return { ok: false, reason: "declined" };
    }
  }

  return { ok: true };
}

/** The footer button and Settings row show only in these states. */
export function updateButtonVisible(state: AppUpdateState | null) {
  return Boolean(
    state &&
      (state.status === "available" ||
        state.status === "downloading" ||
        state.status === "ready" ||
        state.status === "installing" ||
        state.status === "unsupported")
  );
}

interface UseAppUpdateOptions {
  flushSave: () => Promise<void>;
  hasPendingReview: () => boolean;
  onSaveFailed: (error: unknown) => void;
  /** The app menu's "Check for Updates…": show Settings → General before the check. */
  onMenuCheck: () => void;
}

/**
 * The window's mirror of main's update state, the Update click, and the
 * restart preflight (saves, then the review confirmation).
 */
export function useAppUpdate({ flushSave, hasPendingReview, onSaveFailed, onMenuCheck }: UseAppUpdateOptions) {
  const [state, setState] = useState<AppUpdateState | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmResolverRef = useRef<((ok: boolean) => void) | null>(null);
  const latest = useRef({ flushSave, hasPendingReview, onSaveFailed, onMenuCheck });
  latest.current = { flushSave, hasPendingReview, onSaveFailed, onMenuCheck };

  useEffect(() => {
    let cancelled = false;
    const updates = window.iliad.updates;
    const unsubscribe = updates.onStateChanged((next) => setState(next));

    void updates
      .getState()
      .then((next) => {
        if (!cancelled) {
          setState((current) => current ?? next);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const check = useCallback(async () => {
    try {
      setState(await window.iliad.updates.check());
    } catch {
      // Main reports failures through the state; nothing else to show.
    }
  }, []);

  const install = useCallback(() => {
    void window.iliad.updates.install().catch(() => undefined);
  }, []);

  const resolveConfirm = useCallback((ok: boolean) => {
    const resolve = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmOpen(false);
    resolve?.(ok);
  }, []);

  useEffect(
    () =>
      window.iliad.updates.onPrepareRestart((request, controls) =>
        prepareForUpdateRestart({
          mode: request.mode,
          flushSave: () => latest.current.flushSave(),
          hasPendingReview: () => latest.current.hasPendingReview(),
          onSaveFailed: (error) => latest.current.onSaveFailed(error),
          waitingForWriter: controls.waitingForWriter,
          confirm: () =>
            new Promise<boolean>((resolve) => {
              confirmResolverRef.current?.(false);
              confirmResolverRef.current = resolve;
              setConfirmOpen(true);
            })
        })
      ),
    []
  );

  // The app menu's "Check for Updates…" (also when it had to open this window first).
  useEffect(() => {
    let cancelled = false;
    const fromMenu = () => {
      latest.current.onMenuCheck();
      void check();
    };
    const unsubscribe = window.iliad.updates.onCheckRequested(fromMenu);

    void window.iliad.updates
      .consumePendingCheckRequest()
      .then((pending) => {
        if (pending && !cancelled) {
          fromMenu();
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [check]);

  const openUrl = useCallback((url: string | undefined) => {
    if (url) {
      void window.iliad.openUrl(url).catch(() => undefined);
    }
  }, []);

  const openDownload = useCallback(() => openUrl(state?.downloadUrl ?? state?.releaseUrl), [openUrl, state]);
  const openReleaseNotes = useCallback(() => openUrl(state?.releaseUrl), [openUrl, state]);

  return { state, check, install, openDownload, openReleaseNotes, confirmOpen, resolveConfirm };
}
