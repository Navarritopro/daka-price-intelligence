"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type StoreProduct = {
  id: number;
  externalId: string;
  name: string;
  category: string | null;
  url: string;
  price: number;
  inStock: boolean | null;
  scrapedAt: string | null;
  brand?: string | null;
  listPrice?: number | null;
  availableQuantity?: number | null;
};
type Comparison = {
  matchId: number;
  confidence: number;
  matchMethod: string;
  daka: StoreProduct;
  competitor: StoreProduct;
  differenceUsd: number;
  differencePct: number;
};
type ComparisonStats = {
  competitorProducts: number;
  reviewPending: number;
  matchedProducts: number;
  dakaLower: number;
  competitorLower: number;
  equalPrice: number;
  averageGapPct: number;
  competitorLastScrapeAt: string | null;
};
type ComparisonPage = {
  items: Comparison[];
  total: number;
  hasMore: boolean;
  categories: string[];
  stats: ComparisonStats;
};

const BATCH_SIZE = 50;
const money = new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD" });
const integer = new Intl.NumberFormat("es-VE");
const vetDate = new Intl.DateTimeFormat("es-VE", {
  timeZone: "America/Caracas", day: "2-digit", month: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit"
});
const EMPTY_STATS: ComparisonStats = {
  competitorProducts: 0, reviewPending: 0, matchedProducts: 0,
  dakaLower: 0, competitorLower: 0, equalPrice: 0,
  averageGapPct: 0, competitorLastScrapeAt: null
};

function formatDate(value: string | null) {
  return value ? `${vetDate.format(new Date(value))} VET` : "Sin captura";
}

function positionLabel(item: Comparison) {
  if (item.differenceUsd < 0) return "DAKA tiene mejor precio";
  if (item.differenceUsd > 0) return "Damasco tiene mejor precio";
  return "Mismo precio";
}

export default function CompetitorComparison() {
  const [items, setItems] = useState<Comparison[]>([]);
  const [selected, setSelected] = useState<Comparison | null>(null);
  const [stats, setStats] = useState<ComparisonStats>(EMPTY_STATS);
  const [categories, setCategories] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState("");
  const [position, setPosition] = useState("all");
  const [sort, setSort] = useState("gap_desc");
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryVersion = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [search]);

  const parameters = useCallback((offset: number) => new URLSearchParams({
    limit: String(BATCH_SIZE), offset: String(offset), search: debouncedSearch,
    category, position, sort
  }), [category, debouncedSearch, position, sort]);

  useEffect(() => {
    const controller = new AbortController();
    const version = ++queryVersion.current;
    setLoading(true);
    setError(null);
    setItems([]);
    setTotal(0);
    fetch(`/api/comparison?${parameters(0).toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Comparador no disponible");
        return payload as ComparisonPage;
      })
      .then((page) => {
        if (queryVersion.current !== version) return;
        setItems(page.items);
        setSelected(page.items[0] ?? null);
        setTotal(page.total);
        setHasMore(page.hasMore);
        setCategories(page.categories);
        setStats(page.stats);
      })
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        if (queryVersion.current === version) setError(requestError instanceof Error ? requestError.message : "No fue posible cargar el comparador");
      })
      .finally(() => {
        if (queryVersion.current === version) setLoading(false);
      });
    return () => controller.abort();
  }, [parameters]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loading || loadingMore) return;
    setLoadingMore(true);
    const version = queryVersion.current;
    try {
      const response = await fetch(`/api/comparison?${parameters(items.length).toString()}`, { cache: "no-store" });
      const page = await response.json() as ComparisonPage & { error?: string };
      if (!response.ok) throw new Error(page.error ?? "No fue posible cargar más comparaciones");
      if (queryVersion.current !== version) return;
      setItems((current) => [...current, ...page.items.filter((item) => !current.some((known) => known.matchId === item.matchId))]);
      setTotal(page.total);
      setHasMore(page.hasMore);
      setStats(page.stats);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible cargar más comparaciones");
    } finally {
      if (queryVersion.current === version) setLoadingMore(false);
    }
  }, [hasMore, items.length, loading, loadingMore, parameters]);

  return <>
    <section className="competitor-overview">
      <div><span className="eyebrow-dark">Benchmarking competitivo · Fase 2</span><h2>DAKA frente a Damasco</h2><p>Solo se comparan productos equivalentes con coincidencia automática de alta confianza o validación confirmada.</p></div>
      <div className="competitor-freshness"><span>Última captura Damasco</span><strong>{formatDate(stats.competitorLastScrapeAt)}</strong></div>
    </section>

    <section className="comparison-stats">
      <article><span>Catálogo Damasco</span><strong>{loading ? "…" : integer.format(stats.competitorProducts)}</strong><small>Productos monitoreados</small></article>
      <article><span>Productos homologados</span><strong>{loading ? "…" : integer.format(stats.matchedProducts)}</strong><small>Comparaciones confiables</small></article>
      <article className="daka-win"><span>DAKA con mejor precio</span><strong>{loading ? "…" : integer.format(stats.dakaLower)}</strong><small>Oportunidades competitivas</small></article>
      <article className="competitor-win"><span>Damasco con mejor precio</span><strong>{loading ? "…" : integer.format(stats.competitorLower)}</strong><small>Brechas por revisar</small></article>
      <article><span>Por validar</span><strong>{loading ? "…" : integer.format(stats.reviewPending)}</strong><small>No se muestran como equivalentes</small></article>
    </section>

    <section className="filters comparison-filters">
      <input aria-label="Buscar productos comparados" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por producto, SAP, marca o referencia"/>
      <select aria-label="Categoría" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Todas las categorías</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      <select aria-label="Posición competitiva" value={position} onChange={(event) => setPosition(event.target.value)}><option value="all">Todas las posiciones</option><option value="daka_lower">DAKA más económico</option><option value="competitor_lower">Damasco más económico</option><option value="equal">Mismo precio</option></select>
      <select aria-label="Orden" value={sort} onChange={(event) => setSort(event.target.value)}><option value="gap_desc">Mayor brecha primero</option><option value="gap_asc">Menor brecha primero</option><option value="confidence">Mayor confianza</option><option value="recent">Captura más reciente</option></select>
    </section>

    {error && <div className="error-banner"><strong>Comparador pendiente</strong><span>{error}. Verifica que la migración y la primera captura de Damasco estén completadas.</span></div>}

    <section className="comparison-grid">
      <article className="comparison-table-card">
        <div className="section-head"><h2>Productos comparados</h2><small>{loading ? "Consultando…" : `Mostrando ${integer.format(items.length)} de ${integer.format(total)}`}</small></div>
        {loading ? <div className="empty-state">Analizando las coincidencias DAKA–Damasco…</div> : items.length === 0 ? <div className="empty-state">No existen comparaciones confiables con estos filtros.</div> : <div className="table-scroll"><table className="comparison-table"><thead><tr><th>Producto DAKA</th><th>DAKA</th><th>Damasco</th><th>Diferencia</th><th>Posición</th></tr></thead><tbody>{items.map((item) => <tr key={item.matchId} className={selected?.matchId === item.matchId ? "selected-comparison" : ""} onClick={() => setSelected(item)}><td><b>{item.daka.name}</b><small>SAP {item.daka.externalId} · {item.daka.category ?? "Sin categoría"}</small></td><td><strong>{money.format(item.daka.price)}</strong><small>{item.daka.inStock === false ? "Sin stock" : "Disponible"}</small></td><td><strong>{money.format(item.competitor.price)}</strong><small>{item.competitor.externalId}</small></td><td className={item.differenceUsd <= 0 ? "comparison-favorable" : "comparison-unfavorable"}><b>{item.differenceUsd > 0 ? "+" : ""}{money.format(item.differenceUsd)}</b><small>{item.differencePct > 0 ? "+" : ""}{item.differencePct.toFixed(1)}%</small></td><td><span className={`position-badge ${item.differenceUsd < 0 ? "daka" : item.differenceUsd > 0 ? "damasco" : "equal"}`}>{positionLabel(item)}</span></td></tr>)}</tbody></table></div>}
        {items.length > 0 && <div className="changes-load-more">{hasMore ? <button onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "Cargando…" : "Cargar 50 comparaciones más"}</button> : <span>Se mostraron todas las comparaciones</span>}</div>}
      </article>

      <article className="comparison-detail-card">
        {selected ? <><div className="comparison-detail-head"><span className="eyebrow-dark">Equivalencia detectada</span><h2>{selected.daka.name}</h2><p>Confianza {(selected.confidence * 100).toFixed(0)}% · {selected.matchMethod === "model_brand" ? "marca y modelo coincidentes" : "modelo coincidente"}</p></div>
          <div className="store-comparison"><div><span className="store-label daka-store">DAKA</span><strong>{money.format(selected.daka.price)}</strong><small>SAP {selected.daka.externalId}</small><small>{selected.daka.inStock === false ? "Sin stock en última captura" : "Disponible en última captura"}</small><a href={selected.daka.url} target="_blank" rel="noreferrer">Abrir producto DAKA ↗</a></div><div><span className="store-label damasco-store">Damasco</span><strong>{money.format(selected.competitor.price)}</strong>{selected.competitor.listPrice != null && selected.competitor.listPrice > selected.competitor.price && <small>Precio anterior {money.format(selected.competitor.listPrice)}</small>}<small>Ref. {selected.competitor.externalId}</small><small>{selected.competitor.inStock === false ? "No disponible" : selected.competitor.availableQuantity == null ? "Disponible" : `${selected.competitor.availableQuantity} unidades reportadas`}</small><a href={selected.competitor.url} target="_blank" rel="noreferrer">Abrir producto Damasco ↗</a></div></div>
          <div className={`competitive-conclusion ${selected.differenceUsd <= 0 ? "favorable" : "unfavorable"}`}><span>Lectura competitiva</span><strong>{positionLabel(selected)}</strong><p>{selected.differenceUsd === 0 ? "Ambas tiendas presentan el mismo precio." : `La brecha es de ${money.format(Math.abs(selected.differenceUsd))} (${Math.abs(selected.differencePct).toFixed(1)}%) respecto al precio de Damasco.`}</p></div>
          <div className="comparison-meta"><div><span>Captura DAKA</span><b>{formatDate(selected.daka.scrapedAt)}</b></div><div><span>Captura Damasco</span><b>{formatDate(selected.competitor.scrapedAt)}</b></div></div></> : <div className="empty-state detail-empty">Selecciona una comparación para revisar la equivalencia.</div>}
      </article>
    </section>
  </>;
}
