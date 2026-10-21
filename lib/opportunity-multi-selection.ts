export const MAX_OPPORTUNITY_SELECTIONS = 100;

export function selectionKey(value: string) {
  return value.trim().toLocaleLowerCase("es");
}

export function distinctSelections(values: Array<string | null | undefined>) {
  return Array.from(new Map(values.filter((value): value is string => Boolean(value?.trim()))
    .map((value) => [selectionKey(value), value.trim()] as const)).values());
}

export function parseOpportunitySelections(params: URLSearchParams, key: string, allowed?: ReadonlySet<string>) {
  const values = distinctSelections(params.getAll(key).map((value) => value.slice(0, 120)))
    .filter((value) => selectionKey(value) !== "all" && (!allowed || allowed.has(value)));
  return values.slice(0, MAX_OPPORTUNITY_SELECTIONS);
}

export function matchesOpportunitySelection(selected: string[], values: Array<string | null | undefined>) {
  if (selected.length === 0) return true;
  const keys = new Set(selected.map(selectionKey));
  return values.some((value) => value != null && keys.has(selectionKey(value)));
}
