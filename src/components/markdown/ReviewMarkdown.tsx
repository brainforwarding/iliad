import { Component, type ReactNode } from "react";
import { MarkdownContent } from "./MarkdownContent";

interface ReviewMarkdownProps {
  text: string;
  onOpenLink?: (href: string) => void | Promise<void>;
}

interface BoundaryProps {
  fallbackText: string;
  children: ReactNode;
}

/** If Markdown rendering throws, fall back to literal source so review never breaks. */
class ReviewMarkdownBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <pre className="cm-ai-review-rendered-fallback">{this.props.fallbackText}</pre>;
    }

    return this.props.children;
  }
}

export function ReviewMarkdown({ text, onOpenLink }: ReviewMarkdownProps) {
  return (
    <ReviewMarkdownBoundary fallbackText={text}>
      <MarkdownContent text={text} className="cm-ai-review-rendered" onOpenLink={onOpenLink} />
    </ReviewMarkdownBoundary>
  );
}
