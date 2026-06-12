export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function stringProperty(record: Record<string, unknown> | null | undefined, key: string) {
  if (!record) {
    return "";
  }

  const value = record[key];
  return typeof value === "string" ? value : "";
}

export function numericProperty(record: Record<string, unknown> | null | undefined, key: string) {
  if (!record) {
    return null;
  }

  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function recordProperty(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return isRecord(value) ? value : null;
}
