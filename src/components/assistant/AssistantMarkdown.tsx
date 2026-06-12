import { MarkdownContent, safeMarkdownHref } from "../markdown/MarkdownContent";

export { safeMarkdownHref };

export function AssistantMarkdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return <MarkdownContent text={text} className="assistant-markdown" streaming={streaming} />;
}
