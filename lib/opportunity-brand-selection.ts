export const MAX_SELECTED_BRANDS = 100;

export function brandKey(value: string) {
  return value.trim().toLocaleLowerCase("es");
}

export function distinctBrands(values: Array<string | null | undefined>) {
  return Array.from(new Map(values.filter((value): value is string => Boolean(value?.trim()))
    .map((value) => [brandKey(value), value.trim()] as const)).values());
}

export function parseSelectedBrands(searchParams: URLSearchParams) {
  return distinctBrands(searchParams.getAll("brand").slice(0, MAX_SELECTED_BRANDS)
    .map((value) => value.trim().slice(0, 80)));
}

export function matchesSelectedBrands(selected: string[], values: Array<string | null | undefined>) {
  if (selected.length === 0) return true;
  const keys = new Set(selected.map(brandKey));
  return values.some((value) => value != null && keys.has(brandKey(value)));
}
