import { markdownLanguage } from "@codemirror/lang-markdown";

export interface InlineStyleRange {
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
}

/** Use Markdown's own delimiter rules, including nested bold and italics. */
export function collectInlineStyles(text: string) {
  const strong: InlineStyleRange[] = [];
  const emphasis: InlineStyleRange[] = [];
  const code: Array<{ from: number; to: number }> = [];
  markdownLanguage.parser.parse(text).iterate({
    enter(node) {
      if (["InlineCode", "FencedCode", "CodeBlock"].includes(node.name)) {
        code.push({ from: node.from, to: node.to });
        return false;
      }
      if (node.name !== "StrongEmphasis" && node.name !== "Emphasis") return;
      const first = node.node.firstChild;
      const last = node.node.lastChild;
      if (first?.name !== "EmphasisMark" || last?.name !== "EmphasisMark") return;
      (node.name === "StrongEmphasis" ? strong : emphasis).push({
        from: node.from, to: node.to, contentFrom: first.to, contentTo: last.from
      });
    }
  });
  return { strong, emphasis, code };
}
