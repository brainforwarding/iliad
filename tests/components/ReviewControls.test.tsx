import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { editorReviewActionLabelsForMode } from "../../src/app/useOutsideReview";
import { ReviewControls } from "../../src/components/ReviewControls";
import type { EditorReviewState } from "../../src/editor/aiReview/types";
import { appStrings } from "../../src/i18n/strings";
import type { AgentCreateFileProposal, AgentDeleteFileProposal, AgentEditFileProposal } from "../../src/types/iliad";

type Language = "en" | "es";
const noop = () => undefined;

function labelsFor(mode: EditorReviewState["mode"], language: Language) {
  const toolbar = appStrings[language].editor.reviewToolbar;
  return { ...toolbar, ...editorReviewActionLabelsForMode(mode, toolbar) };
}

function editReview(language: Language, overrides: Partial<Extract<EditorReviewState, { mode: "edit_file" }>> = {}) {
  return {
    mode: "edit_file",
    file: { id: "f1", kind: "edit_file", relativePath: "notes/draft.md", status: "pending" } as unknown as AgentEditFileProposal,
    currentContent: "",
    activeHunkId: null,
    readOnly: true,
    onAcceptHunk: noop,
    onRejectHunk: noop,
    onAcceptFile: noop,
    onRejectFile: noop,
    labels: labelsFor("edit_file", language),
    ...overrides
  } as EditorReviewState;
}

function render(review: EditorReviewState, { stale = false, hunkCount = 3 } = {}) {
  return renderToStaticMarkup(
    <ReviewControls review={review} stale={stale} hunkCount={hunkCount} onPrevious={noop} onNext={noop} />
  );
}

/** Visible text and aria-labels of each button, in order, with its disabled state. */
function buttons(markup: string) {
  return [...markup.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(([, attrs, body]) => ({
    text: body.replace(/<[^>]+>/g, ""),
    label: /aria-label="([^"]*)"/.exec(attrs)?.[1] ?? null,
    disabled: /\sdisabled=""/.test(attrs)
  }));
}

describe("ReviewControls (top-row outside review)", () => {
  it("shows the count, ↑ ↓, Keep all and Restore all for an edit (EN)", () => {
    const markup = render(editReview("en"));

    expect(markup).toContain(">3 changes<");
    expect(buttons(markup)).toEqual([
      { text: "", label: "Previous change", disabled: false },
      { text: "", label: "Next change", disabled: false },
      { text: "Keep all", label: null, disabled: false },
      { text: "Restore all", label: null, disabled: false }
    ]);
    expect(markup).toContain('data-tooltip="Previous change"');
    expect(markup).toContain('aria-label="notes/draft.md"');
  });

  it("uses Spanish labels", () => {
    const markup = render(editReview("es"), { hunkCount: 1 });

    expect(markup).toContain(">1 cambio<");
    expect(buttons(markup).map((button) => button.label ?? button.text)).toEqual([
      "Cambio anterior",
      "Cambio siguiente",
      "Conservar todo",
      "Restaurar todo"
    ]);
  });

  it("disables the arrows and Keep all when nothing is left to review", () => {
    const result = buttons(render(editReview("en"), { hunkCount: 0 }));

    expect(result.map((button) => button.disabled)).toEqual([true, true, true, false]);
  });

  it("shows only the stale label and Restore all for a stale review", () => {
    const markup = render(editReview("en"), { stale: true });

    expect(markup).toContain(">Stale<");
    expect(buttons(markup)).toEqual([{ text: "Restore all", label: null, disabled: false }]);
  });

  it("disables every file action while an action is busy, but not navigation", () => {
    const result = buttons(render(editReview("en", { actionBusy: true })));

    expect(result.map((button) => button.disabled)).toEqual([false, false, true, true]);
  });

  it("shows the two decisions for a created or deleted document", () => {
    const created = {
      mode: "create_file",
      file: { id: "c1", kind: "create_file", relativePath: "new.md" } as unknown as AgentCreateFileProposal,
      currentContent: "",
      onAcceptFile: noop,
      onRejectFile: noop,
      labels: labelsFor("create_file", "en")
    } as EditorReviewState;
    const deleted = {
      mode: "delete_file",
      file: { id: "d1", kind: "delete_file", relativePath: "old.md" } as unknown as AgentDeleteFileProposal,
      currentContent: "",
      actionBusy: true,
      onAcceptFile: noop,
      onRejectFile: noop,
      labels: labelsFor("delete_file", "es")
    } as EditorReviewState;

    expect(buttons(render(created))).toEqual([
      { text: "Keep file", label: null, disabled: false },
      { text: "Move to Trash", label: null, disabled: false }
    ]);
    expect(buttons(render(deleted)).map((button) => [button.text, button.disabled])).toEqual([
      [appStrings.es.editor.reviewToolbar.confirmDeletion, true],
      [appStrings.es.editor.reviewToolbar.restoreFile, true]
    ]);
  });
});
