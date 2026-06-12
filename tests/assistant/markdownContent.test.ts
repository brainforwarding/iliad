import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { MarkdownContent, safeMarkdownHref } from "../../src/components/markdown/MarkdownContent";

describe("MarkdownContent", () => {
  it("renders LaTeX-delimited math via KaTeX after normalization", () => {
    const html = renderToStaticMarkup(createElement(MarkdownContent, { text: "Angle \\( \\theta \\)." }));
    expect(html).toContain("katex");
  });

  it("routes links through onOpenLink and neutralizes unsafe hrefs", () => {
    const safe = renderToStaticMarkup(
      createElement(MarkdownContent, { text: "[x](https://example.test)", onOpenLink: () => undefined })
    );
    expect(safe).toContain('href="https://example.test"');

    const unsafe = renderToStaticMarkup(createElement(MarkdownContent, { text: "[x](javascript:alert(1))" }));
    expect(unsafe).toContain("markdown-link-unsafe");
    expect(unsafe).not.toContain("javascript:alert");
    expect(safeMarkdownHref("javascript:alert(1)")).toBeNull();
  });
});
