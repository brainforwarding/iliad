import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EditorEmptyState } from "../../src/components/EditorEmptyState";
import { appStrings } from "../../src/i18n/strings";
import type { RecentDocumentItem } from "../../src/preferences/recentDocuments";

const noop = () => undefined;

const recents: RecentDocumentItem[] = [
  { relativePath: "essays/on-walking.md", name: "on-walking", folder: "essays", dayLabel: "Today", openedAt: "" },
  { relativePath: "readme.md", name: "readme", folder: "", dayLabel: "Yesterday", openedAt: "" }
];

function render(lang: "en" | "es", items: RecentDocumentItem[]) {
  return renderToStaticMarkup(
    <EditorEmptyState
      labels={appStrings[lang].editor}
      recentDocuments={items}
      onOpenRecentDocument={noop}
      onCreateDocument={noop}
    />
  );
}

describe("editor empty state G", () => {
  it("shows recent documents as buttons, then New document ⌘N", () => {
    const html = render("en", recents);

    expect(html).toContain("Pick up where you left off");
    expect(html).not.toContain("Pick a document to start");
    expect(html).toContain('aria-label="Recent documents"');
    expect(html.match(/class="editor-empty__recent"/g)).toHaveLength(2);
    expect(html).toContain('<span class="editor-empty__recent-name">on-walking</span>');
    expect(html).toContain('<span class="editor-empty__recent-folder">essays</span>');
    expect(html).toContain('<span class="editor-empty__recent-day">Today</span>');
    // A root document has no folder span.
    expect(html).toContain('<span class="editor-empty__recent-name">readme</span><span class="editor-empty__recent-day">Yesterday</span>');
    expect(html).toContain("New document");
    expect(html).toContain("⌘N");
    expect(html).not.toContain("clip-mark");
    expect(html.indexOf("editor-empty__recents")).toBeLessThan(html.indexOf("editor-empty__new"));
  });

  it("shows only the line and the link without recents", () => {
    const html = render("en", []);

    expect(html).toContain("Pick a document to start");
    expect(html).not.toContain("editor-empty__recents");
    expect(html).toContain("editor-empty__new");
  });

  it("speaks Spanish", () => {
    expect(render("es", recents)).toContain("Retoma donde lo dejaste");
    expect(render("es", recents)).toContain('aria-label="Documentos recientes"');
    const empty = render("es", []);
    expect(empty).toContain("Elige un documento para empezar");
    expect(empty).toContain("Nuevo documento");
  });
});
