const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function deepPatch<T>(current: T, patch: unknown): T {
  if (!isRecord(current) || !isRecord(patch)) return patch as T;
  const result: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    result[key] = isRecord(value) && isRecord(result[key])
      ? deepPatch(result[key], value)
      : value;
  }
  return result as T;
}
