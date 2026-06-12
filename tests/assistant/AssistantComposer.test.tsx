import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssistantComposer } from "../../src/components/assistant/AssistantComposer";
import { appStrings } from "../../src/i18n/strings";
import type { AssistantContextAttachmentChip, MarkdownContextDocument } from "../../src/assistant/contextAttachments";
import type { DictationState } from "../../src/assistant/useDictation";

const idleDictation: DictationState = {
  error: null,
  isBusy: false,
  isSupported: true,
  mimeType: null,
  status: "idle",
  statusText: null,
  cancel: () => undefined,
  clearError: () => undefined,
  toggle: () => undefined
};

function renderComposer(options: {
  prompt: string;
  contextAttachments?: AssistantContextAttachmentChip[];
  contextDocuments?: MarkdownContextDocument[];
  contextDocumentsTruncated?: boolean;
}) {
  return renderToStaticMarkup(
    <AssistantComposer
      contextAttachments={options.contextAttachments ?? []}
      contextDocuments={options.contextDocuments ?? []}
      contextDocumentsTruncated={options.contextDocumentsTruncated ?? false}
      contextFileName="report.md"
      contextFilePath="notes/report.md"
      contextStatusText={null}
      dictation={idleDictation}
      highlightedContextAttachmentId={null}
      labels={appStrings.en.assistant}
      prompt={options.prompt}
      promptPlaceholder="Ask anything..."
      runningRunId={null}
      sendDisabled={false}
      sendDisabledReason={undefined}
      textareaRef={null}
      onAddContextAttachment={() => true}
      onAsk={() => undefined}
      onCancel={() => undefined}
      onPromptChange={() => undefined}
      onRemoveContextAttachment={() => undefined}
      onRemoveLastContextAttachment={() => false}
    />
  );
}

describe("AssistantComposer context attachments", () => {
  it("renders the textarea-backed listbox for active @ queries", () => {
    const html = renderComposer({
      prompt: "@rep",
      contextDocuments: [
        {
          relativePath: "reports/reporte-control-calidad.md",
          name: "reporte-control-calidad.md",
          sizeBytes: 100,
          estimatedTokens: 25
        }
      ],
      contextDocumentsTruncated: true
    });

    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('role="option"');
    expect(html).toContain("reporte-control-calidad.md");
    expect(html).toContain("reports/reporte-control-calidad.md");
    expect(html).toContain("Keep typing to narrow results");
  });

  it("renders no-results and accessible chip remove labels", () => {
    const html = renderComposer({
      prompt: "@missing",
      contextAttachments: [
        {
          id: "ctx-1",
          relativePath: "reports/reporte-control-calidad.md",
          label: "reporte-control-calidad.md",
          source: "mention_picker"
        }
      ],
      contextDocuments: []
    });

    expect(html).toContain("No matching Markdown files");
    expect(html).toContain('aria-label="Current file context: notes/report.md"');
    expect(html).toContain('aria-label="Remove reports/reporte-control-calidad.md from context"');
    // Long file names truncate inside the pill: both the current-file chip and
    // manual chips wrap their text in the ellipsizing label span.
    expect(html).toContain("assistant-context-file-chip");
    expect(html).toContain('<span class="assistant-context-chip-label">report.md</span>');
    expect(html).toContain('<span class="assistant-context-chip-label">reporte-control-calidad.md</span>');
  });
});
