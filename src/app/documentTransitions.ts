/** One ordered lane for document opens, closes, and workspace switches. */
export function createDocumentTransitions() {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  return {
    isBusy: () => pending > 0,
    run<T>(operation: () => Promise<T>): Promise<T> {
      pending++;
      const result = tail.then(operation);
      tail = result.catch(() => undefined);
      return result.finally(() => { pending--; });
    }
  };
}

/** Flush again when typing/comments changed during the preceding I/O. */
export async function settleDocument(
  flushText: () => Promise<void>,
  flushComments: () => Promise<void>,
  isSettled: () => boolean
) {
  do {
    await flushText();
    await flushComments();
  } while (!isSettled());
}
