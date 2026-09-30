"use client";

import { useCallback, useEffect, useState } from "react";
import AvailabilityHistory from "@/components/availability-history";

export type AvailabilitySource = "all" | "daka" | "damasco" | "multimax" | "ivoo" | "venelectronics";

type AvailabilityMovement = "up" | "down" | "same" | "restocked" | "out" | "unquantified" | "no_baseline" | "not_seen";
type AvailabilityItem = {
  id: number;
  externalId: string;
  name: string;
  category: string | null;
  url: string;
  brand: string | null;
  model: string | null;
  source: Exclude<AvailabilitySource, "all">;
  sourceName: string;
  previousQuantity: number | null;
  currentQuantity: number | null;
  previousInStock: boolean | null;
  currentInStock: boolean | null;
  previousScrapedAt: string | null;
  currentScrapedAt: string | null;
  quantityDifference: number | null;
  quantityChangePct: number | null;
  movement: AvailabilityMovement;
};
type ComparisonWindow = {
  source: Exclude<AvailabilitySource, "all">;
  sourceName: string;
  currentFinishedAt: string | null;
  previousFinishedAt: string | null;
};
type AvailabilityPage = {
  items: AvailabilityItem[];
  total: number;
  hasMore: boolean;
  stats: {
    productsCompared: number;
    increased: number;
    decreased: number;
    unchanged: number;
    statusChanges: number;
    unquantified: number;
  };
  comparisons: ComparisonWindow[];
  categories: string[];
  error?: string;
};

const BATCH_SIZE = 50;
const integer = new Intl.NumberFormat("es-VE");
const decimal = new Intl.NumberFormat("es-VE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const vetDate = new Intl.DateTimeFormat("es-VE", {
  timeZone: "America/Caracas", day: "2-digit", month: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit"
});

function formatDate(value: string | null) {
  return value ? `${vetDate.format(new Date(value))} VET` : "Sin captura";
}

function quantityLabel(quantity: number | null, inStock: boolean | null, capturedAt: string | null) {
  if (!capturedAt) return "No visto";
  if (quantity != null) return `${integer.format(quantity)} unidades`;
  if (inStock === false) return "Sin stock";
  if (inStock === true) return "Disponible · sin cantidad";
  return "Sin cantidad reportada";
}

const movementLabels: Record<AvailabilityMovement, string> = {
  up: "↑ Aumentó",
  down: "↓ Disminuyó",
  same: "• Sin variación",
  restocked: "↗ Ingresó stock",
  out: "× Se agotó",
  unquantified: "Cantidad no determinada",
  no_baseline: "Sin base de comparación",
  not_seen: "No visto actualmente"
};

function LatestAvailability({ source }: { source: AvailabilitySource }) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [movement, setMovement] = useState("all");
  const [category, setCategory] = useState("");
  const [items, setItems] = useState<AvailabilityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [comparisons, setComparisons] = useState<ComparisonWindow[]>([]);
  const [stats, setStats] = useState({ productsCompared: 0, increased: 0, decreased: 0, unchanged: 0, statusChanges: 0, unquantified: 0 });

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setCategory("");
  }, [source]);

  const parameters = useCallback((offset: number) => new URLSearchParams({
    source,
    search: debouncedSearch,
    movement,
    category,
    limit: String(BATCH_SIZE),
    offset: String(offset)
  }), [category, debouncedSearch, movement, source]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setItems([]);
    setTotal(0);
    setHasMore(false);
    fetch(`/api/availability-changes?${parameters(0)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const page = await response.json() as AvailabilityPage;
        if (!response.ok) throw new Error(page.error ?? "Disponibilidad no disponible");
        return page;
      })
      .then((page) => {
        setItems(page.items);
        setTotal(page.total);
        setHasMore(page.hasMore);
        setStats(page.stats);
        setComparisons(page.comparisons);
        setCategories(page.categories);
      })
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError(requestError instanceof Error ? requestError.message : "No fue posible cargar las variaciones de disponibilidad");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [parameters]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(`/api/availability-changes?${parameters(items.length)}`, { cache: "no-store" });
      const page = await response.json() as AvailabilityPage;
      if (!response.ok) throw new Error(page.error ?? "No fue posible cargar más productos");
      setItems((current) => [...current, ...page.items]);
      setTotal(page.total);
      setHasMore(page.hasMore);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible cargar más productos");
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, items.length, loading, loadingMore, parameters]);

  const periodLabel = comparisons.length === 1
    ? `${formatDate(comparisons[0].currentFinishedAt)} vs. ${formatDate(comparisons[0].previousFinishedAt)}`
    : "Última ejecución exitosa vs. ejecución exitosa anterior de cada fuente";

  return <section className="competitor-availability">
    <div className="availability-head"><div><span className="eyebrow-dark">Inteligencia competitiva · Inventario</span><h2>Variaciones de disponibilidad</h2><p>Compara la cantidad reportada en las dos últimas ejecuciones exitosas de DAKA y sus competidores.</p></div><div><span>Comparación</span><strong>{periodLabel}</strong></div></div>
    <div className="availability-summary">
      <article><span>Productos comparados</span><strong>{loading ? "…" : integer.format(stats.productsCompared)}</strong></article>
      <article className="availability-up"><span>Aumentaron unidades</span><strong>{loading ? "…" : integer.format(stats.increased)}</strong></article>
      <article className="availability-down"><span>Disminuyeron unidades</span><strong>{loading ? "…" : integer.format(stats.decreased)}</strong></article>
      <article><span>Sin variación</span><strong>{loading ? "…" : integer.format(stats.unchanged)}</strong></article>
      <article className="availability-status"><span>Cambio de estado</span><strong>{loading ? "…" : integer.format(stats.statusChanges)}</strong></article>
    </div>
    <div className="availability-filters">
      <input aria-label="Buscar producto por disponibilidad" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto, referencia, marca o modelo"/>
      <select aria-label="Movimiento de disponibilidad" value={movement} onChange={(event) => setMovement(event.target.value)}><option value="all">Todos los movimientos</option><option value="up">Aumentó</option><option value="down">Disminuyó</option><option value="same">Sin variación</option><option value="restocked">Ingresó stock</option><option value="out">Se agotó</option><option value="unquantified">Sin cantidad exacta</option><option value="no_baseline">Sin base de comparación</option><option value="not_seen">No visto actualmente</option></select>
      <select aria-label="Categoría de disponibilidad" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Todas las categorías</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select>
    </div>
    {error && <div className="error-banner"><strong>Consulta pendiente</strong><span>{error}</span></div>}
    <article className="availability-table-card">
      <div className="section-head"><h2>Disponibilidad por producto</h2><small>{loading ? "Comparando capturas…" : `Mostrando ${integer.format(items.length)} de ${integer.format(total)}`}</small></div>
      {loading ? <div className="empty-state">Comparando las dos últimas ejecuciones exitosas…</div> : !items.length ? <div className="empty-state">No existen productos con estos filtros.</div> : <div className="table-scroll"><table className="availability-table"><thead><tr><th>Producto</th><th>Competidor</th><th>Anterior</th><th>Actual</th><th>Variación</th><th>Movimiento</th><th>Última captura</th></tr></thead><tbody>{items.map((item) => <tr key={`${item.source}-${item.id}`}><td><a href={item.url} target="_blank" rel="noreferrer">{item.name}</a><small>Ref. {item.externalId}{item.category ? ` · ${item.category}` : ""}</small></td><td><span className={`availability-source ${item.source}`}>{item.sourceName}</span></td><td>{quantityLabel(item.previousQuantity, item.previousInStock, item.previousScrapedAt)}</td><td>{quantityLabel(item.currentQuantity, item.currentInStock, item.currentScrapedAt)}</td><td className={item.quantityDifference == null ? "neutral" : item.quantityDifference > 0 ? "availability-positive" : item.quantityDifference < 0 ? "availability-negative" : "neutral"}><strong>{item.quantityDifference == null ? "—" : `${item.quantityDifference > 0 ? "+" : ""}${integer.format(item.quantityDifference)}`}</strong><small>{item.quantityChangePct == null ? item.movement === "restocked" ? "Nuevo stock" : "" : `${item.quantityChangePct > 0 ? "+" : ""}${decimal.format(item.quantityChangePct)}%`}</small></td><td><span className={`availability-movement ${item.movement}`}>{movementLabels[item.movement]}</span></td><td>{formatDate(item.currentScrapedAt)}</td></tr>)}</tbody></table></div>}
      <div className="changes-load-more">{hasMore ? <button onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "Cargando…" : "Cargar 50 productos más"}</button> : items.length ? <span>Se mostraron todos los productos con estos filtros</span> : null}</div>
    </article>
  </section>;
}

export default function CompetitorAvailability({ source }: { source: AvailabilitySource }) {
  const [view, setView] = useState<"latest" | "history">("latest");
  return <div className="availability-module">
    <nav className="availability-view-tabs" aria-label="Vista de disponibilidad">
      <button className={view === "latest" ? "active" : ""} onClick={() => setView("latest")}>Última comparación</button>
      <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}>Histórico de disponibilidad</button>
    </nav>
    {view === "latest" ? <LatestAvailability source={source}/> : <AvailabilityHistory source={source}/>} 
  </div>;
}
