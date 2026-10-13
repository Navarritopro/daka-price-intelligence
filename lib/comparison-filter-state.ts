export type ComparisonFilterKey = "search" | "brand" | "category" | "position" | "sort";

export type ComparisonFilterState = {
  search: string;
  brand: string;
  category: string;
  position: string;
  sort: string;
};

export const DEFAULT_COMPARISON_FILTERS: ComparisonFilterState = {
  search: "",
  brand: "",
  category: "",
  position: "all",
  sort: "gap_desc"
};

export function describeComparisonFilters(state: ComparisonFilterState, competitorName: string) {
  const filters: Array<{ key: ComparisonFilterKey; label: string }> = [];
  const search = state.search.trim();
  if (search) filters.push({ key: "search", label: `Búsqueda: ${search}` });
  if (state.brand) filters.push({ key: "brand", label: `Marca: ${state.brand}` });
  if (state.category) filters.push({ key: "category", label: `Categoría: ${state.category}` });
  if (state.position !== "all") {
    const labels: Record<string, string> = {
      daka_lower: "DAKA más económico",
      competitor_lower: `${competitorName} más económico`,
      equal: "Mismo precio"
    };
    filters.push({ key: "position", label: `Posición: ${labels[state.position] ?? state.position}` });
  }
  if (state.sort !== "gap_desc") {
    const labels: Record<string, string> = {
      gap_asc: "Menor brecha primero",
      confidence: "Mayor confianza",
      recent: "Captura más reciente"
    };
    filters.push({ key: "sort", label: `Orden: ${labels[state.sort] ?? state.sort}` });
  }
  return filters;
}
