import { describe, expect, it } from "vitest";
import { createDocumentTransitions, settleDocument } from "../../src/app/documentTransitions";

describe("document transitions", () => {
  it("serializes delayed opens and close operations without poisoning the queue after failure", async () => {
    const queue = createDocumentTransitions();
    const events: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const first = queue.run(async () => { events.push("read A"); await blocked; events.push("commit A"); });
    const failed = queue.run(async () => { events.push("read B"); throw new Error("missing B"); });
    const close = queue.run(async () => { events.push("close A"); });
    const failure = expect(failed).rejects.toThrow("missing B");
    await Promise.resolve();
    expect(events).toEqual(["read A"]);
    expect(queue.isBusy()).toBe(true);
    release();
    await Promise.all([first, failure, close]);
    expect(events).toEqual(["read A", "commit A", "read B", "close A"]);
    expect(queue.isBusy()).toBe(false);
  });

  it("saves text typed during an awaited comment write before allowing activation", async () => {
    let text = "old";
    let saved = "";
    let commentsSaved = false;
    const writes: string[] = [];
    await settleDocument(async () => { saved = text; writes.push(text); }, async () => {
      if (!commentsSaved) { await Promise.resolve(); text = "late typing"; commentsSaved = true; }
    }, () => saved === text && commentsSaved);
    expect(writes).toEqual(["old", "late typing"]);
  });

  it("keeps a failed comment write from committing a close even with clean text", async () => {
    let activated = false;
    await expect((async () => {
      await settleDocument(async () => undefined, async () => { throw new Error("comments disk full"); }, () => true);
      activated = true;
    })()).rejects.toThrow("comments disk full");
    expect(activated).toBe(false);
  });
});
