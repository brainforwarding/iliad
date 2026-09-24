/**
 * The `stem.comments.md` companion format (spec V14). Pure and shared by main
 * (legacy migration) and the renderer (`src/comments/commentsFile.ts`).
 *
 * ```markdown
 * <!-- iliad:comment id=c1 -->
 * > The quoted passage,
 * > possibly on several lines.
 *
 * The comment text.
 *
 * ---
 *
 * <!-- iliad:comment id=c2 occurrence=2 prefix="text before the quote" -->
 * > A passage that appears more than once
 *
 * Another comment.
 * ```
 *
 * Entries are separated by a blank line, `---`, and a blank line. The
 * metadata line carries the id, plus `occurrence` and `prefix` only when the
 * quote is not unique in the document. Comment lines that equal `---`, start
 * with `>`, or start with `<!-- iliad:` are escaped with a backslash. Text the
 * parser does not recognise (hand-written notes, an entry without a quote) is
 * kept as the comment text of an entry with an empty quote, so nothing a
 * person or an agent wrote is lost on the next write.
 */

export interface CommentsFileEntry {
  id: string;
  /** The exact quoted passage; empty for text that is not anchored to a passage. */
  quote: string;
  comment: string;
  /** 1-based occurrence of the quote, written only when the quote is not unique. */
  occurrence?: number;
  /** Text right before the quote, written only when the quote is not unique. */
  prefix?: string;
}

const metadataPattern = /^<!--\s*iliad:comment\b(.*?)-->\s*$/;
const escapablePattern = /^(?:---\s*$|>|<!--\s*iliad:)/;

function escapeCommentLine(line: string) {
  return escapablePattern.test(line.replace(/^\\+/, "")) ? `\\${line}` : line;
}

function unescapeCommentLine(line: string) {
  return /^\\/.test(line) && escapablePattern.test(line.replace(/^\\+/, "")) ? line.slice(1) : line;
}

function isSeparator(line: string) {
  return /^---\s*$/.test(line);
}

function trimBlankLines(lines: string[]) {
  let start = 0;
  let end = lines.length;

  while (start < end && !lines[start].trim()) {
    start += 1;
  }

  while (end > start && !lines[end - 1].trim()) {
    end -= 1;
  }

  return lines.slice(start, end);
}

/** Stable id for an entry written without a metadata line (by hand or by an agent). */
function contentId(quote: string, comment: string) {
  let hash = 0x811c9dc5;

  for (const character of `${quote}\u0000${comment}`) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return `c${hash.toString(36)}`;
}

function sanitizeId(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 160);
}

function encodePrefix(prefix: string) {
  // JSON escaping keeps quotes and newlines on one line; `--` never appears
  // raw, so the HTML comment cannot be closed early.
  return JSON.stringify(prefix).replace(/--/g, "-\\u002d");
}

function parseMetadata(attributes: string) {
  const id = /\bid=([A-Za-z0-9_-]+)/.exec(attributes)?.[1];
  const occurrenceMatch = /\boccurrence=(\d+)/.exec(attributes);
  const prefixMatch = /\bprefix=("(?:[^"\\]|\\.)*")/.exec(attributes);
  let prefix: string | undefined;

  if (prefixMatch) {
    try {
      const parsed = JSON.parse(prefixMatch[1]) as unknown;
      prefix = typeof parsed === "string" ? parsed : undefined;
    } catch {
      prefix = undefined;
    }
  }

  const occurrence = occurrenceMatch ? Number(occurrenceMatch[1]) : undefined;

  return {
    id: id ? sanitizeId(id) : undefined,
    occurrence: occurrence && occurrence > 0 ? occurrence : undefined,
    prefix
  };
}

function parseEntryLines(lines: string[]): CommentsFileEntry | null {
  const trimmed = trimBlankLines(lines);

  if (trimmed.length === 0) {
    return null;
  }

  let index = 0;
  const metadataMatch = metadataPattern.exec(trimmed[0]);
  const metadata = metadataMatch ? parseMetadata(metadataMatch[1]) : null;

  if (metadataMatch) {
    index = 1;
  }

  const quoteLines: string[] = [];

  while (index < trimmed.length && trimmed[index].startsWith(">")) {
    quoteLines.push(trimmed[index].replace(/^> ?/, ""));
    index += 1;
  }

  const quote = quoteLines.join("\n");
  const comment = trimBlankLines(trimmed.slice(index)).map(unescapeCommentLine).join("\n");

  if (!metadata && !quote && !comment) {
    return null;
  }

  const entry: CommentsFileEntry = {
    id: metadata?.id || contentId(quote, comment),
    quote,
    comment
  };

  if (metadata?.occurrence !== undefined) {
    entry.occurrence = metadata.occurrence;
  }

  if (metadata?.prefix !== undefined) {
    entry.prefix = metadata.prefix;
  }

  return entry;
}

export function parseCommentsFile(text: string): CommentsFileEntry[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[][] = [[]];

  for (const line of lines) {
    if (isSeparator(line)) {
      blocks.push([]);
      continue;
    }

    // A metadata line always starts a new entry, even when the separator
    // before it is missing (hand-edited files).
    if (metadataPattern.test(line) && trimBlankLines(blocks[blocks.length - 1]).length > 0) {
      blocks.push([]);
    }

    blocks[blocks.length - 1].push(line);
  }

  const entries: CommentsFileEntry[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const entry = parseEntryLines(block);

    if (!entry) {
      continue;
    }

    // Ids stay unique so merges by id never conflate two entries.
    let id = entry.id;
    let suffix = 2;

    while (seen.has(id)) {
      id = `${entry.id}-${suffix}`;
      suffix += 1;
    }

    seen.add(id);
    entries.push({ ...entry, id });
  }

  return entries;
}

function serializeEntry(entry: CommentsFileEntry) {
  const id = sanitizeId(entry.id) || contentId(entry.quote, entry.comment);
  const anchor =
    entry.occurrence !== undefined && entry.occurrence > 0
      ? ` occurrence=${Math.floor(entry.occurrence)} prefix=${encodePrefix(entry.prefix ?? "")}`
      : "";
  const lines = [`<!-- iliad:comment id=${id}${anchor} -->`];

  if (entry.quote) {
    for (const line of entry.quote.replace(/\r\n?/g, "\n").split("\n")) {
      lines.push(line ? `> ${line}` : ">");
    }
  }

  const comment = trimBlankLines(entry.comment.replace(/\r\n?/g, "\n").split("\n")).map(escapeCommentLine);

  if (comment.length > 0) {
    lines.push("", ...comment);
  }

  return lines.join("\n");
}

export function serializeCommentsFile(entries: CommentsFileEntry[]): string {
  if (entries.length === 0) {
    return "";
  }

  return `${entries.map(serializeEntry).join("\n\n---\n\n")}\n`;
}

/** Number of (possibly overlapping) occurrences of `quote` in `text`. */
export function countQuoteOccurrences(text: string, quote: string) {
  if (!quote) {
    return 0;
  }

  let count = 0;
  let index = text.indexOf(quote);

  while (index !== -1) {
    count += 1;
    index = text.indexOf(quote, index + 1);
  }

  return count;
}
