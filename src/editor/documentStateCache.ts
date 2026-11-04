import { historyField } from "@codemirror/commands";
import { EditorState, type EditorSelection, type Extension, type Text } from "@codemirror/state";

export interface DocumentScrollPosition {
  top: number;
  left: number;
}

interface CachedWritingState {
  revision: number;
  doc: Text;
  selection: EditorSelection;
  history: unknown;
  scroll: DocumentScrollPosition;
}

/** In-memory writing state only. Review decorations, callbacks and plugins never enter the cache. */
export class DocumentStateCache {
  private entries = new Map<string, CachedWritingState>();
  private generations = new Map<string, number>();
  private sequence = 0;
  private epoch = 0;

  generation(documentId: string): number {
    return this.generations.get(documentId) ?? this.epoch;
  }

  capture(documentId: string, revision: number, state: EditorState, scroll: DocumentScrollPosition, generation: number): void {
    // A close/invalidation can happen before the outgoing host snapshots its state.
    // Its old lease must not resurrect an entry that the owner just removed.
    if (generation !== this.generation(documentId)) return;
    this.entries.set(documentId, {
      revision, doc: state.doc, selection: state.selection,
      history: state.field(historyField, false), scroll: { ...scroll }
    });
  }

  createState(documentId: string, revision: number, value: string, extensions: Extension, cacheable = true): {
    state: EditorState;
    scroll: DocumentScrollPosition;
    restored: boolean;
  } {
    const candidate = cacheable ? this.entries.get(documentId) : undefined;
    const cached = candidate?.revision === revision && candidate.doc.toString() === value ? candidate : undefined;
    if (candidate && !cached) this.invalidate(documentId);
    return {
      state: EditorState.create({
        doc: value,
        selection: cached?.selection,
        extensions: [extensions, cached?.history === undefined ? [] : historyField.init(() => cached.history)]
      }),
      scroll: cached ? { ...cached.scroll } : { top: 0, left: 0 },
      restored: Boolean(cached)
    };
  }

  invalidate(documentId: string): void {
    this.entries.delete(documentId);
    this.generations.set(documentId, ++this.sequence);
  }

  delete(documentId: string): void {
    this.invalidate(documentId);
  }

  clear(): void {
    this.entries.clear();
    this.generations.clear();
    this.epoch = ++this.sequence;
  }
}

export function createDocumentStateCache(): DocumentStateCache {
  return new DocumentStateCache();
}

/** A committed activation owns async work, including a later return to the same file. */
export class DocumentActivation {
  private token: object = {};
  enter(): void { this.token = {}; }
  capture(): () => boolean {
    const token = this.token;
    return () => token === this.token;
  }
}
