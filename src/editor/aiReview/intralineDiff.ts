export interface IntralineRange {
  from: number;
  to: number;
}

interface Token {
  text: string;
  from: number;
  to: number;
}

const tokenPattern = /\s+|[^\s]+/g;

export function intralineTokenDiff(oldText: string, newText: string) {
  const oldTokens = tokenize(oldText);
  const newTokens = tokenize(newText);
  const oldChanged = new Set<number>();
  const newChanged = new Set<number>();
  const dp = Array.from({ length: oldTokens.length + 1 }, () => Array<number>(newTokens.length + 1).fill(0));

  for (let oldIndex = oldTokens.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newTokens.length - 1; newIndex >= 0; newIndex -= 1) {
      dp[oldIndex][newIndex] =
        oldTokens[oldIndex].text === newTokens[newIndex].text
          ? dp[oldIndex + 1][newIndex + 1] + 1
          : Math.max(dp[oldIndex + 1][newIndex], dp[oldIndex][newIndex + 1]);
    }
  }

  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldTokens.length || newIndex < newTokens.length) {
    if (
      oldIndex < oldTokens.length &&
      newIndex < newTokens.length &&
      oldTokens[oldIndex].text === newTokens[newIndex].text
    ) {
      oldIndex += 1;
      newIndex += 1;
      continue;
    }

    if (newIndex >= newTokens.length || (oldIndex < oldTokens.length && dp[oldIndex + 1][newIndex] >= dp[oldIndex][newIndex + 1])) {
      oldChanged.add(oldIndex);
      oldIndex += 1;
    } else {
      newChanged.add(newIndex);
      newIndex += 1;
    }
  }

  return {
    oldRanges: changedRanges(oldTokens, oldChanged),
    newRanges: changedRanges(newTokens, newChanged)
  };
}

function tokenize(text: string): Token[] {
  return Array.from(text.matchAll(tokenPattern), (match) => ({
    text: match[0],
    from: match.index,
    to: match.index + match[0].length
  }));
}

function changedRanges(tokens: Token[], changedIndexes: Set<number>): IntralineRange[] {
  const ranges: IntralineRange[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    if (!changedIndexes.has(index)) {
      continue;
    }

    const token = tokens[index];
    const previous = ranges[ranges.length - 1];

    if (previous && token.from <= previous.to) {
      previous.to = token.to;
    } else {
      ranges.push({ from: token.from, to: token.to });
    }
  }

  return ranges.filter((range) => range.to > range.from);
}
