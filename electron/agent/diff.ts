function splitLines(value: string) {
  const lines = value.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function lcsMatrix(a: string[], b: string[]) {
  const matrix = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      matrix[i][j] = a[i] === b[j] ? matrix[i + 1][j + 1] + 1 : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
    }
  }

  return matrix;
}

export function unifiedDiff(original: string, next: string, relativePath: string) {
  if (original === next) {
    return `--- a/${relativePath}\n+++ b/${relativePath}\n`;
  }

  const a = splitLines(original);
  const b = splitLines(next);
  const matrix = lcsMatrix(a, b);
  const rows: string[] = [`--- a/${relativePath}`, `+++ b/${relativePath}`, "@@ Markdown replacement @@"];
  let i = 0;
  let j = 0;

  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      rows.push(` ${a[i]}`);
      i += 1;
      j += 1;
    } else if (j < b.length && (i === a.length || matrix[i][j + 1] >= matrix[i + 1][j])) {
      rows.push(`+${b[j]}`);
      j += 1;
    } else if (i < a.length) {
      rows.push(`-${a[i]}`);
      i += 1;
    }
  }

  return `${rows.join("\n")}\n`;
}
