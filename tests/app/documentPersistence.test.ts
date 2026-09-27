import { describe, expect, it } from "vitest";
import { createAutosaveFence } from "../../src/app/autosaveFence";
import { documentCloseRequiresChoice, type SaveStatus } from "../../src/app/useDocumentPersistence";

describe("documentCloseRequiresChoice", () => {
  it("prompts only for unsaved or errored documents", () => {
    const statuses: Record<SaveStatus, boolean> = {
      saved: false,
      saving: false,
      unsaved: true,
      error: true,
      conflict: true
    };

    for (const [status, expected] of Object.entries(statuses) as Array<[SaveStatus, boolean]>) {
      expect(documentCloseRequiresChoice(status)).toBe(expected);
    }
  });
});

describe("autosave fence", () => {
  function deferred<T = void>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it("disarms, waits for a save in flight, runs, then re-arms", async () => {
    const fence = createAutosaveFence();
    const events: string[] = [];
    const save = deferred();
    void fence.trackSave(save.promise.then(() => events.push("save done")));

    const run = fence.run(
      async () => {
        events.push(`operation (held: ${fence.isHeld()})`);
        return "renamed";
      },
      { disarm: () => events.push("disarm"), rearm: () => events.push("rearm") }
    );

    await Promise.resolve();
    expect(events).toEqual(["disarm"]);
    expect(fence.isHeld()).toBe(true);
    expect(fence.hasSaveInFlight()).toBe(true);

    save.resolve();
    await expect(run).resolves.toBe("renamed");
    expect(events).toEqual(["disarm", "save done", "operation (held: true)", "rearm"]);
    expect(fence.isHeld()).toBe(false);
    expect(fence.hasSaveInFlight()).toBe(false);
  });

  it("still runs when the save in flight failed, and re-arms when the operation throws", async () => {
    const fence = createAutosaveFence();
    const events: string[] = [];
    void fence.trackSave(Promise.reject(new Error("disk full"))).catch(() => undefined);

    await expect(
      fence.run(
        async () => {
          events.push("operation");
          throw new Error("rename failed");
        },
        { disarm: () => events.push("disarm"), rearm: () => events.push("rearm") }
      )
    ).rejects.toThrow("rename failed");
    expect(events).toEqual(["disarm", "operation", "rearm"]);
    expect(fence.isHeld()).toBe(false);
  });

  it("lets a flush wait for the fence to be released", async () => {
    const fence = createAutosaveFence();
    const operation = deferred();
    const events: string[] = [];
    const run = fence.run(() => operation.promise, { disarm: () => undefined, rearm: () => events.push("rearm") });

    const flush = (async () => {
      while (fence.isHeld()) {
        await fence.whenReleased();
      }
      events.push("flush");
    })();

    await Promise.resolve();
    expect(events).toEqual([]);
    operation.resolve();
    await run;
    await flush;
    expect(events).toEqual(["rearm", "flush"]);
  });

  it("runs one operation at a time", async () => {
    const fence = createAutosaveFence();
    const first = deferred();
    const events: string[] = [];
    const hooks = { disarm: () => undefined, rearm: () => undefined };
    const a = fence.run(async () => {
      events.push("a start");
      await first.promise;
      events.push("a end");
    }, hooks);
    const b = fence.run(async () => {
      events.push("b");
    }, hooks);

    await Promise.resolve();
    await Promise.resolve();
    first.resolve();
    await Promise.all([a, b]);
    expect(events).toEqual(["a start", "a end", "b"]);
  });
});
