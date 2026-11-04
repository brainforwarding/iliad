import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DocumentTabs, documentTabFocusIndex, documentTabRevealScrollLeft } from "../../src/components/DocumentTabs";
import { appStrings } from "../../src/i18n/strings";

const documents = [
  { id: "draft", name: "Draft", relativePath: "writing/Draft.md", suffix: "writing" },
  { id: "outline", name: "Draft", relativePath: "notes/Draft.md", suffix: "notes" },
  { id: "research", name: "Research", relativePath: "Research.md" }
];

describe("DocumentTabs", () => {
  it("keeps tab order, marks one active tab, and exposes paths for duplicate names", () => {
    const html = renderToStaticMarkup(
      <DocumentTabs documents={documents} activeId="outline" labels={appStrings.en.topbar.tabs}
        onActivate={() => undefined} onClose={() => undefined} />
    );
    expect(html).toContain('role="tablist" aria-label="Open documents"');
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Draft (writing/Draft.md)"');
    expect(html).toContain('data-tooltip="notes/Draft.md"');
    expect(html).toContain('aria-label="Close notes/Draft.md"');
    expect(html.indexOf("writing/Draft.md")).toBeLessThan(html.indexOf("notes/Draft.md"));
    expect(html).toContain('class="document-tab__suffix">notes<');
    // Close actions are siblings of activation buttons, never nested controls.
    for (const button of html.matchAll(/<button\b[^>]*>(.*?)<\/button>/g)) {
      expect(button[1]).not.toContain("<button");
    }
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((match) => match[0]);
    expect(tabs.map((tab) => /tabindex="0"/.test(tab))).toEqual([false, true, false]);
  });

  it("localizes the tablist and each close action", () => {
    const html = renderToStaticMarkup(
      <DocumentTabs documents={documents} activeId="draft" labels={appStrings.es.topbar.tabs}
        onActivate={() => undefined} onClose={() => undefined} />
    );
    expect(html).toContain('aria-label="Documentos abiertos"');
    expect(html).toContain('aria-label="Cerrar writing/Draft.md"');
  });
});

describe("document tab focus navigation", () => {
  it("wraps arrows and supports Home and End without treating activation keys as navigation", () => {
    expect(documentTabFocusIndex(0, 3, "ArrowLeft")).toBe(2);
    expect(documentTabFocusIndex(2, 3, "ArrowRight")).toBe(0);
    expect(documentTabFocusIndex(1, 3, "Home")).toBe(0);
    expect(documentTabFocusIndex(1, 3, "End")).toBe(2);
    for (const key of ["Enter", " ", "Tab", "Delete"]) {
      expect(documentTabFocusIndex(1, 3, key)).toBeNull();
    }
    expect(documentTabFocusIndex(0, 0, "Home")).toBeNull();
    expect(documentTabFocusIndex(0, 1, "ArrowLeft")).toBe(0);
  });
});

describe("document tab scroll reveal", () => {
  it("moves only as far as needed and leaves visible items in place", () => {
    expect(documentTabRevealScrollLeft(100, 200, 130, 260)).toBe(100);
    expect(documentTabRevealScrollLeft(100, 200, 20, 80)).toBe(20);
    expect(documentTabRevealScrollLeft(100, 200, 280, 380)).toBe(180);
    expect(documentTabRevealScrollLeft(100, 80, 180, 420)).toBe(180);
  });
});
