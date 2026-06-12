import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { latexMathToDollar } from "../../markdown/mathDelimiters";

const allowedSchemePattern = /^(https?:|mailto:|file:)/i;
const schemePattern = /^[a-z][a-z0-9+.-]*:/i;

export function safeMarkdownHref(href: string | undefined) {
  if (!href) {
    return null;
  }

  const trimmed = href.trim();

  if (allowedSchemePattern.test(trimmed)) {
    return trimmed;
  }

  return schemePattern.test(trimmed) ? null : trimmed;
}

interface MarkdownContentProps {
  text: string;
  className?: string;
  /**
   * When provided, links route through this handler instead of navigating, and
   * pointer events are stopped so they don't disturb a host editor's selection.
   */
  onOpenLink?: (href: string) => void | Promise<void>;
  /**
   * Live-draft rendering: math plugins are skipped (partially streamed
   * `$…` expressions are the expensive, flicker-prone case).
   */
  streaming?: boolean;
}

/**
 * Shared Markdown renderer (config only — callers supply their own className/CSS).
 * Used by the assistant transcript and the AI-review proposed-change preview.
 */
export function MarkdownContent({ text, className, onOpenLink, streaming = false }: MarkdownContentProps) {
  const components: Components = {
    a({ href, children }) {
      const safeHref = safeMarkdownHref(href);

      if (!safeHref) {
        return <span className="markdown-link-unsafe">{children}</span>;
      }

      if (onOpenLink) {
        return (
          <a
            href={safeHref}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void onOpenLink(safeHref);
            }}
          >
            {children}
          </a>
        );
      }

      return (
        <a href={safeHref} target="_blank" rel="noreferrer">
          {children}
        </a>
      );
    }
  };

  return (
    <div className={className}>
      <ReactMarkdown
        components={components}
        rehypePlugins={streaming ? [] : [rehypeKatex]}
        remarkPlugins={streaming ? [remarkGfm] : [remarkGfm, remarkMath]}
      >
        {streaming ? text : latexMathToDollar(text)}
      </ReactMarkdown>
    </div>
  );
}
