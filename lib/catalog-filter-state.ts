export type CatalogFilterKey = "search" | "brand" | "category" | "status" | "stock" | "change";

export type CatalogFilterState = {
  search: string;
  brand: string;
  category?: string;
  status: string;
  stock?: string;
  change: string;
};

export type PriceChangeFilterKey = "search" | "brand" | "days" | "movement" | "threshold" | "status";

export type PriceChangeFilterState = {
  search: string;
  brand: string;
  days: string;
  movement: string;
  threshold: string;
  status: string;
};

type DescribeOptions = {
  historyMode?: boolean;
  reportMode?: boolean;
};

export function describeCatalogFilters(state: CatalogFilterState, options: DescribeOptions = {}) {
  const filters: Array<{ key: CatalogFilterKey; label: string }> = [];
  const search = state.search.trim();
  if (search) filters.push({ key: "search", label: `Búsqueda: ${search}` });
  if (state.brand) filters.push({ key: "brand", label: `Marca: ${state.brand}` });
  if (state.category && !options.historyMode) filters.push({ key: "category", label: `Categoría: ${state.category}` });
  if (!options.historyMode && state.status !== "current") {
    const labels: Record<string, string> = {
      missing: "No vistos actualmente",
      all: "Todos los históricos"
    };
    filters.push({ key: "status", label: `Estado: ${labels[state.status] ?? state.status}` });
  }
  if (state.stock && state.stock !== "all" && !options.historyMode) {
    const labels: Record<string, string> = { in: "Con stock", out: "Sin stock" };
    filters.push({ key: "stock", label: `Disponibilidad: ${labels[state.stock] ?? state.stock}` });
  }
  if (state.change !== "all") {
    const labels: Record<string, string> = { down: "Rebajas", up: "Aumentos", same: "Sin cambios" };
    filters.push({ key: "change", label: `Variación: ${labels[state.change] ?? state.change}` });
  }
  return filters;
}

export function describePriceChangeFilters(state: PriceChangeFilterState, options: DescribeOptions = {}) {
  const filters: Array<{ key: PriceChangeFilterKey; label: string }> = [];
  const search = state.search.trim();
  if (search) filters.push({ key: "search", label: `Búsqueda: ${search}` });
  if (state.brand) filters.push({ key: "brand", label: `Marca: ${state.brand}` });
  if (!options.reportMode && state.days !== "30") {
    const labels: Record<string, string> = {
      "1": "Hoy",
      "7": "Últimos 7 días",
      "90": "Últimos 90 días",
      all: "Todo el histórico"
    };
    filters.push({ key: "days", label: `Período: ${labels[state.days] ?? state.days}` });
  }
  if (state.movement !== "all") {
    const labels: Record<string, string> = { down: "Solo rebajas", up: "Solo aumentos" };
    filters.push({ key: "movement", label: `Movimiento: ${labels[state.movement] ?? state.movement}` });
  }
  if (state.threshold !== "0") filters.push({ key: "threshold", label: `Magnitud: ≥ ${state.threshold}%` });
  if (!options.reportMode && state.status !== "current") {
    const labels: Record<string, string> = {
      missing: "No vistos actualmente",
      all: "Todos los históricos"
    };
    filters.push({ key: "status", label: `Estado: ${labels[state.status] ?? state.status}` });
  }
  return filters;
}
