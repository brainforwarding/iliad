/**
 * The autosave fence (spec 2026-09-27 "Name untitled documents", Review):
 * an operation that must not race a save of the active document (the guarded
 * auto-rename) runs with autosave paused. Entering the fence disarms the
 * pending timer and waits for a save already in flight; while it is held,
 * typing only marks the buffer dirty; leaving it re-arms autosave, which then
 * saves to wherever the document lives now. Pure and React-free so the
 * ordering can be tested; `useDocumentPersistence` owns one instance.
 */
export interface AutosaveFenceHooks {
  /** Cancel and disarm the autosave timer. */
  disarm: () => void;
  /** Re-arm autosave (schedules a save when the buffer is dirty). */
  rearm: () => void;
}

export interface AutosaveFence {
  /** True while an operation holds the fence: autosave must not arm. */
  isHeld: () => boolean;
  /** True while a tracked save is in flight. */
  hasSaveInFlight: () => boolean;
  /** Registers a save so the fence waits for it; returns the same promise. */
  trackSave: <T>(save: Promise<T>) => Promise<T>;
  /** Resolves once no operation holds the fence (immediately when free). */
  whenReleased: () => Promise<void>;
  /** Runs `operation` with autosave paused (see the module comment). */
  run: <T>(operation: () => Promise<T>, hooks: AutosaveFenceHooks) => Promise<T>;
}

export function createAutosaveFence(): AutosaveFence {
  let holders = 0;
  let released: Promise<void> = Promise.resolve();
  let release: (() => void) | null = null;
  const inFlight = new Set<Promise<unknown>>();

  const waitForSaves = async () => {
    while (inFlight.size > 0) {
      await Promise.allSettled([...inFlight]);
    }
  };

  return {
    isHeld: () => holders > 0,
    hasSaveInFlight: () => inFlight.size > 0,
    trackSave: (save) => {
      inFlight.add(save);
      const settle = () => {
        inFlight.delete(save);
      };
      save.then(settle, settle);
      return save;
    },
    whenReleased: () => released,
    run: async (operation, hooks) => {
      // One holder at a time: a second operation waits for the first.
      while (holders > 0) {
        await released;
      }

      holders += 1;
      released = new Promise<void>((resolve) => {
        release = resolve;
      });
      hooks.disarm();

      try {
        await waitForSaves();
        return await operation();
      } finally {
        holders -= 1;
        const done = release;
        release = null;
        hooks.rearm();
        done?.();
      }
    }
  };
}
