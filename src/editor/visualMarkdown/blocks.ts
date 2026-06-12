import type { Range, Text } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { addBlockedRange, type BlockedRange } from "./activeRanges";
import { BulletWidget, CheckboxWidget, HiddenSyntaxWidget, HorizontalRuleWidget } from "./widgets";

export type HeadingMatch = RegExpExecArray | null;
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface SetextHeadings {
  contentLineLevels: Map<number, HeadingLevel>;
  markerLineLevels: Map<number, HeadingLevel>;
}

export function addBlockLineDecorations(ranges: Range<Decoration>[], lineFrom: number, text: string): HeadingMatch {
  const headingMatch = /^(#{1,6})\s+(.+)$/.exec(text);

  if (headingMatch) {
    ranges.push(Decoration.line({ class: `cm-md-heading-line cm-md-heading-${headingMatch[1].length}` }).range(lineFrom));
  }

  if (/^\s*>\s?/.test(text)) {
    ranges.push(Decoration.line({ class: "cm-md-blockquote-line" }).range(lineFrom));
  }

  if (/^\s*([-*+]|\d+\.)\s+/.test(text)) {
    ranges.push(Decoration.line({ class: "cm-md-list-line" }).range(lineFrom));
  }

  return headingMatch;
}

export function isThematicBreak(text: string) {
  return /^\s*((-{3,})|(\*{3,})|(_{3,}))\s*$/.test(text);
}

export function addThematicBreakDecoration(ranges: Range<Decoration>[], lineFrom: number, lineTo: number) {
  ranges.push(Decoration.line({ class: "cm-md-horizontal-rule-line" }).range(lineFrom));
  ranges.push(Decoration.replace({ widget: new HorizontalRuleWidget() }).range(lineFrom, lineTo));
}

function setextLevel(text: string): HeadingLevel | null {
  const match = /^\s*(=+|-+)\s*$/.exec(text);

  if (!match) {
    return null;
  }

  return match[1][0] === "=" ? 1 : 2;
}

function canBeSetextContent(text: string) {
  const trimmed = text.trim();

  if (!trimmed) {
    return false;
  }

  return (
    !/^(#{1,6})\s+/.test(trimmed) &&
    !/^\s*>\s?/.test(text) &&
    !/^\s*([-*+]|\d+\.)\s+/.test(text) &&
    !/^\s*(```|~~~)/.test(text) &&
    !/^\s*\|/.test(text) &&
    !isThematicBreak(text) &&
    !setextLevel(text)
  );
}

export function collectSetextHeadings(document: Text): SetextHeadings {
  const contentLineLevels = new Map<number, HeadingLevel>();
  const markerLineLevels = new Map<number, HeadingLevel>();

  for (let lineNumber = 2; lineNumber <= document.lines; lineNumber += 1) {
    const markerLine = document.line(lineNumber);
    const level = setextLevel(markerLine.text);

    if (!level) {
      continue;
    }

    const contentLine = document.line(lineNumber - 1);

    if (!canBeSetextContent(contentLine.text)) {
      continue;
    }

    contentLineLevels.set(contentLine.number, level);
    markerLineLevels.set(markerLine.number, level);
  }

  return { contentLineLevels, markerLineLevels };
}

export function addSetextMarkerDecoration(ranges: Range<Decoration>[], lineFrom: number, lineTo: number) {
  ranges.push(Decoration.line({ class: "cm-md-setext-marker-line" }).range(lineFrom));
  ranges.push(Decoration.replace({ widget: new HiddenSyntaxWidget() }).range(lineFrom, lineTo));
}

export function addInactiveBlockSyntaxDecorations(
  ranges: Range<Decoration>[],
  lineFrom: number,
  text: string,
  headingMatch: HeadingMatch,
  blockedRanges: BlockedRange[],
  labels: {
    markTaskIncomplete: string;
    markTaskComplete: string;
  }
) {
  if (headingMatch) {
    const markerEnd = lineFrom + headingMatch[1].length + 1;
    ranges.push(Decoration.replace({ widget: new HiddenSyntaxWidget() }).range(lineFrom, markerEnd));
  }

  const blockquoteMatch = /^(\s*)(>\s?)/.exec(text);

  if (blockquoteMatch) {
    const markerFrom = lineFrom + blockquoteMatch[1].length;
    const markerTo = markerFrom + blockquoteMatch[2].length;
    ranges.push(Decoration.replace({ widget: new HiddenSyntaxWidget() }).range(markerFrom, markerTo));
    addBlockedRange(blockedRanges, markerFrom, markerTo);
  }

  const taskMatch = /^(\s*[-*+]\s+)(\[[ xX]\])\s+/.exec(text);

  if (taskMatch) {
    const markerFrom = lineFrom + taskMatch[1].length;
    const markerTo = markerFrom + taskMatch[2].length;
    const checked = /\[[xX]\]/.test(taskMatch[2]);
    ranges.push(
      Decoration.replace({
        widget: new CheckboxWidget(checked, markerFrom, markerTo, labels)
      }).range(markerFrom, markerTo)
    );
    addBlockedRange(blockedRanges, markerFrom, markerTo);
  }

  const bulletMatch = /^(\s*)([-*+])\s+/.exec(text);

  if (bulletMatch && !taskMatch) {
    const bulletFrom = lineFrom + bulletMatch[1].length;
    const bulletTo = bulletFrom + bulletMatch[2].length;
    ranges.push(Decoration.replace({ widget: new BulletWidget() }).range(bulletFrom, bulletTo));
    addBlockedRange(blockedRanges, bulletFrom, bulletTo);
  }
}
