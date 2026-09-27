import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BreadcrumbName } from "../../src/components/BreadcrumbName";
import { TypedName } from "../../src/components/TypedName";

describe("TypedName", () => {
  it("starts typing with a caret and a ✦, while the accessible name is already final", () => {
    const html = renderToStaticMarkup(<TypedName text="plan-de-sesion" />);
    expect(html).toContain('<span class="sr-only">plan-de-sesion</span>');
    expect(html).toContain("is-typing");
    expect(html).toContain("typed-name-caret");
    expect(html).toContain('class="typed-name-spark" aria-hidden="true">✦');
    expect(html).toMatch(/class="typed-name-text" aria-hidden="true"><span class="typed-name-caret">/);
  });
});

describe("BreadcrumbName", () => {
  const noop = () => undefined;
  const base = {
    name: "untitled",
    canRename: true,
    renaming: false,
    renameLabel: "Rename untitled",
    onStartRename: noop,
    onCommitRename: noop,
    onCancelRename: noop
  };

  it("shows the name as the current page", () => {
    expect(renderToStaticMarkup(<BreadcrumbName {...base} />)).toBe(
      '<span class="topbar-breadcrumb-current" aria-current="page">untitled</span>'
    );
  });

  it("types a fresh auto-name", () => {
    expect(renderToStaticMarkup(<BreadcrumbName {...base} name="Plan de sesión" typingKey={7} />)).toContain("typed-name");
  });

  it("opens an inline field only when the document can be renamed", () => {
    const field = renderToStaticMarkup(<BreadcrumbName {...base} renaming />);
    expect(field).toContain('class="topbar-breadcrumb-input"');
    expect(field).toContain('aria-label="Rename untitled"');
    expect(field).toContain('value="untitled"');

    expect(renderToStaticMarkup(<BreadcrumbName {...base} renaming canRename={false} />)).not.toContain("input");
  });
});
