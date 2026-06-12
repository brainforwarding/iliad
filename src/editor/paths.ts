export function resolveMarkdownAssetPath(documentPath: string, markdownPath: string) {
  const rawPath = markdownPath.trim().replace(/^<|>$/g, "");

  if (!rawPath || /^(https?:|data:|blob:)/i.test(rawPath)) {
    return rawPath;
  }

  const normalizedDocument = documentPath.replace(/\\/g, "/");
  const normalizedAsset = decodeURI(rawPath).replace(/\\/g, "/");

  if (normalizedAsset.startsWith("/") || /^[A-Za-z]:\//.test(normalizedAsset)) {
    return normalizedAsset;
  }

  const baseParts = normalizedDocument.split("/").slice(0, -1);
  const assetParts = normalizedAsset.split("/");
  const combined = [...baseParts];

  for (const part of assetParts) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      combined.pop();
      continue;
    }

    combined.push(part);
  }

  return combined.join("/");
}
