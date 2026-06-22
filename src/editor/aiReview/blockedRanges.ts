export type ReviewBlockedMode = "edit_file" | "create_file" | "delete_file" | null | undefined;

export interface ReviewBlockedLineRangesInput {
  mode: ReviewBlockedMode;
  currentContent: string;
  editChangedLineRanges?: Array<{ from: number; to: number }> | null;
  tightenChangedLineRanges?: Array<{ from: number; to: number }>;
}

export function markdownLineCount(text: string) {
  return Math.max(1, text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").length);
}

export function reviewBlockedLineRanges({
  mode,
  currentContent,
  editChangedLineRanges,
  tightenChangedLineRanges = []
}: ReviewBlockedLineRangesInput) {
  if (mode === "edit_file") {
    return editChangedLineRanges ?? [];
  }

  if (mode === "create_file" || mode === "delete_file") {
    return [{ from: 1, to: markdownLineCount(currentContent) }];
  }

  return tightenChangedLineRanges;
}
