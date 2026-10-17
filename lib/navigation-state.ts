export type QueryValue = string | number | boolean | null | undefined;

export function mergeQueryString(currentSearch: string, changes: Record<string, QueryValue>) {
  const params = new URLSearchParams(currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch);
  for (const [key, value] of Object.entries(changes)) {
    if (value == null || value === "" || value === false) params.delete(key);
    else params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function allowedQueryValue<T extends string>(params: URLSearchParams, key: string, allowed: readonly T[], fallback: T) {
  const value = params.get(key);
  return value && allowed.includes(value as T) ? value as T : fallback;
}

export function queryText(params: URLSearchParams, key: string, maximumLength = 120) {
  return (params.get(key) ?? "").trim().slice(0, maximumLength);
}
