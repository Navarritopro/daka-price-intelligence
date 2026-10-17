"use client";

import { type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import MatchReview from "@/components/match-review";
import MatchManagement from "@/components/match-management";
import CompetitorHistory from "@/components/competitor-history";
import FilterFeedback, { type ActiveFilter } from "@/components/filter-feedback";
import { readApiJson } from "@/lib/api-client";
import { describeComparisonFilters, type ComparisonFilterKey } from "@/lib/comparison-filter-state";

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
  reviewAlternatives: number;
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
  brands: string[];
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
  competitorProducts: 0, reviewPending: 0, reviewAlternatives: 0, matchedProducts: 0,
  dakaLower: 0, competitorLower: 0, equalPrice: 0,
  averageGapPct: 0, competitorLastScrapeAt: null
};
type CompetitorSource = "damasco" | "multimax" | "ivoo" | "venelectronics" | "soytechno";
const COMPETITORS: Record<CompetitorSource, { name: string; short: string }> = {
  damasco: { name: "Damasco", short: "D" },
  multimax: { name: "Multimax", short: "MM" },
  ivoo: { name: "IVOO", short: "IV" },
  venelectronics: { name: "Venelectronics", short: "VE" },
  soytechno: { name: "SoyTechno", short: "ST" },
};

function formatDate(value: string | null) {
  return value ? `${vetDate.format(new Date(value))} VET` : "Sin captura";
}

function positionLabel(item: Comparison, competitorName: string) {
  if (item.differenceUsd < 0) return "DAKA tiene mejor precio";
  if (item.differenceUsd > 0) return `${competitorName} tiene mejor precio`;
  return "Mismo precio";
}

function matchMethodLabel(method: string) {
  const labels: Record<string, string> = {
    model_brand: "marca y modelo coincidentes", model: "modelo coincidente",
    brand_type_attributes: "marca, tipo y especificaciones validadas",
    type_attributes: "tipo y especificaciones confirmadas manualmente",
    brand_attributes: "marca y características confirmadas manualmente"
  };
  return labels[method] ?? "equivalencia confirmada";
}

function moveTabFocus(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  index: number,
  refs: MutableRefObject<Array<HTMLButtonElement | null>>
) {
  const tabs = refs.current.filter((tab): tab is HTMLButtonElement => Boolean(tab));
  if (!tabs.length) return;
  let nextIndex: number | null = null;
  if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
  if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = tabs.length - 1;
  if (nextIndex == null) return;
  event.preventDefault();
  tabs[nextIndex]?.focus();
  tabs[nextIndex]?.click();
}

function gapDirection(item: Comparison, competitorName: string) {
  if (item.differenceUsd < 0) return { symbol: "↓", text: "Ventaja DAKA" };
  if (item.differenceUsd > 0) return { symbol: "↑", text: `Ventaja ${competitorName}` };
  return { symbol: "=", text: "Precio igual" };
}

export default function CompetitorComparison({ canAdmin = false }: { canAdmin?: boolean }) {
  const [source, setSource] = useState<CompetitorSource>("damasco");
  const competitor = COMPETITORS[source];
  const [mode, setMode] = useState<"comparison" | "review" | "manage">("comparison");
  const [analysisView, setAnalysisView] = useState<"current" | "history">("current");
  const [refreshToken, setRefreshToken] = useState(0);
  const [items, setItems] = useState<Comparison[]>([]);
  const [selected, setSelected] = useState<Comparison | null>(null);
  const [stats, setStats] = useState<ComparisonStats>(EMPTY_STATS);
  const [categories, setCategories] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [brands, setBrands] = useState<string[]>([]);
  const [position, setPosition] = useState("all");
  const [sort, setSort] = useState("gap_desc");
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryVersion = useRef(0);
  const sourceTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const analysisTabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const activeFilters = useMemo<ActiveFilter[]>(() => {
    const remove = (key: ComparisonFilterKey) => {
      if (key === "search") { setSearch(""); setDebouncedSearch(""); }
      if (key === "brand") setBrand("");
      if (key === "category") setCategory("");
      if (key === "position") setPosition("all");
      if (key === "sort") setSort("gap_desc");
    };
    return describeComparisonFilters({ search, brand, category, position, sort }, competitor.name)
      .map((filter) => ({ ...filter, onRemove: () => remove(filter.key) }));
  }, [brand, category, competitor.name, position, search, sort]);

  const clearFilters = useCallback(() => {
    setSearch("");
    setDebouncedSearch("");
    setBrand("");
    setCategory("");
    setPosition("all");
    setSort("gap_desc");
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [search]);

  const parameters = useCallback((offset: number) => new URLSearchParams({
    limit: String(BATCH_SIZE), offset: String(offset), search: debouncedSearch,
    category, brand, position, sort, source
  }), [brand, category, debouncedSearch, position, sort, source]);

  useEffect(() => {
    const controller = new AbortController();
    const version = ++queryVersion.current;
    setLoading(true);
    setError(null);
    setItems([]);
    setTotal(0);
    fetch(`/api/comparison?${parameters(0).toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await readApiJson<ComparisonPage & { error?: string }>(response, "Comparador no disponible");
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
        setBrands(page.brands ?? []);
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
  }, [parameters, refreshToken]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loading || loadingMore) return;
    setLoadingMore(true);
    const version = queryVersion.current;
    try {
      const nextParameters = parameters(items.length);
      nextParameters.set("includeMetadata", "0");
      const response = await fetch(`/api/comparison?${nextParameters.toString()}`, { cache: "no-store" });
      const page = await readApiJson<ComparisonPage & { error?: string }>(response, "No fue posible cargar más comparaciones");
      if (!response.ok) throw new Error(page.error ?? "No fue posible cargar más comparaciones");
      if (queryVersion.current !== version) return;
      setItems((current) => [...current, ...page.items.filter((item) => !current.some((known) => known.matchId === item.matchId))]);
      setTotal(page.total);
      setHasMore(page.hasMore);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible cargar más comparaciones");
    } finally {
      if (queryVersion.current === version) setLoadingMore(false);
    }
  }, [hasMore, items.length, loading, loadingMore, parameters]);

  if (mode === "review") {
    return <MatchReview
      source={source}
      competitorName={competitor.name}
      onBack={() => {
        setRefreshToken((current) => current + 1);
        setMode("comparison");
      }}
      onDecision={() => setRefreshToken((current) => current + 1)}
    />;
  }

  if (mode === "manage") {
    return <MatchManagement
      source={source}
      competitorName={competitor.name}
      onBack={() => { setRefreshToken((current) => current + 1); setMode("comparison"); }}
      onChanged={() => setRefreshToken((current) => current + 1)}
    />;
  }

  return <div className={`competitor-comparison source-${source}`}>
    <nav className="competitor-source-tabs" aria-label="Seleccionar competidor" role="tablist" data-tour="comparison-source-tabs">
      {(Object.entries(COMPETITORS) as [CompetitorSource, { name: string; short: string }][]).map(([slug, item], index) => <button key={slug} ref={(element) => { sourceTabRefs.current[index] = element; }} id={`comparison-source-tab-${slug}`} type="button" role="tab" aria-selected={source === slug} aria-controls="comparison-source-panel" tabIndex={source === slug ? 0 : -1} className={source === slug ? "active" : ""} onKeyDown={(event) => moveTabFocus(event, index, sourceTabRefs)} onClick={() => { setSource(slug); setCategory(""); setBrand(""); setMode("comparison"); }}>{item.name}</button>)}
    </nav>
    <div id="comparison-source-panel" role="tabpanel" aria-labelledby={`comparison-source-tab-${source}`}>
    <nav className="comparison-view-tabs" aria-label="Tipo de análisis competitivo" role="tablist" data-tour="comparison-view-tabs"><button ref={(element) => { analysisTabRefs.current[0] = element; }} id="comparison-view-current" type="button" role="tab" aria-selected={analysisView === "current"} aria-controls="comparison-current-panel" tabIndex={analysisView === "current" ? 0 : -1} className={analysisView === "current" ? "active" : ""} onKeyDown={(event) => moveTabFocus(event, 0, analysisTabRefs)} onClick={() => setAnalysisView("current")}>Posición actual</button><button ref={(element) => { analysisTabRefs.current[1] = element; }} id="comparison-view-history" type="button" role="tab" aria-selected={analysisView === "history"} aria-controls="comparison-history-panel" tabIndex={analysisView === "history" ? 0 : -1} className={analysisView === "history" ? "active" : ""} onKeyDown={(event) => moveTabFocus(event, 1, analysisTabRefs)} onClick={() => setAnalysisView("history")}>Histórico competitivo</button></nav>
    {analysisView === "history" ? <div id="comparison-history-panel" role="tabpanel" aria-labelledby="comparison-view-history"><CompetitorHistory source={source} competitorName={competitor.name}/></div> : <div id="comparison-current-panel" role="tabpanel" aria-labelledby="comparison-view-current">
    <section className="competitor-overview" aria-labelledby="comparison-title">
      <div><span className="eyebrow-dark">Benchmarking competitivo · Multicompetidor</span><h2 id="comparison-title">DAKA frente a {competitor.name}</h2><p>Solo se comparan productos equivalentes con coincidencia automática de alta confianza o validación confirmada.</p></div>
      <div className="competitor-overview-actions">
        <div className="competitor-freshness"><span>Última captura {competitor.name}</span><strong>{formatDate(stats.competitorLastScrapeAt)}</strong></div>
        <button className="secondary-button" type="button" onClick={() => setMode("review")}>
          Revisar {integer.format(stats.reviewPending)} productos
        </button>
        {canAdmin && <button className="secondary-button" type="button" onClick={() => setMode("manage")}>Administrar homologaciones</button>}
      </div>
    </section>

    <section className="comparison-stats" aria-label={`Resumen de comparación entre DAKA y ${competitor.name}`} aria-busy={loading} data-tour="comparison-summary">
      <article><span>Catálogo {competitor.name}</span><strong>{loading ? "…" : integer.format(stats.competitorProducts)}</strong><small>Productos monitoreados</small></article>
      <article><span>Productos homologados</span><strong>{loading ? "…" : integer.format(stats.matchedProducts)}</strong><small>Comparaciones confiables</small></article>
      <article className="daka-win"><span>DAKA con mejor precio</span><strong>{loading ? "…" : integer.format(stats.dakaLower)}</strong><small>Oportunidades competitivas</small></article>
      <article className="competitor-win"><span>{competitor.name} con mejor precio</span><strong>{loading ? "…" : integer.format(stats.competitorLower)}</strong><small>Brechas por revisar</small></article>
      <article><span>Productos por validar</span><strong>{loading ? "…" : integer.format(stats.reviewPending)}</strong><small>{integer.format(stats.reviewAlternatives)} alternativas analizadas</small></article>
    </section>

    <section className="filters comparison-filters" aria-label="Filtros del comparador" data-tour="comparison-filters">
      <label className="comparison-field"><span>Buscar producto</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Producto, SAP, marca o referencia"/></label>
      <label className="comparison-field"><span>Marca</span><select value={brand} onChange={(event) => setBrand(event.target.value)}><option value="">Todas las marcas</option>{brands.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="comparison-field"><span>Categoría</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Todas las categorías</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="comparison-field"><span>Posición competitiva</span><select value={position} onChange={(event) => setPosition(event.target.value)}><option value="all">Todas las posiciones</option><option value="daka_lower">DAKA más económico</option><option value="competitor_lower">{competitor.name} más económico</option><option value="equal">Mismo precio</option></select></label>
      <label className="comparison-field"><span>Ordenar resultados</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="gap_desc">Mayor brecha primero</option><option value="gap_asc">Menor brecha primero</option><option value="confidence">Mayor confianza</option><option value="recent">Captura más reciente</option></select></label>
    </section>
    <FilterFeedback filters={activeFilters} visible={items.length} total={total} loading={loading} onClear={clearFilters}/>

    {error && <div className="error-banner comparison-error" role="alert"><div><strong>Comparador pendiente</strong><span>{error}. Verifica que la migración y la primera captura de {competitor.name} estén completadas.</span></div><button type="button" onClick={() => setRefreshToken((current) => current + 1)}>Reintentar</button></div>}

    <p className="sr-only" aria-live="polite">{selected ? `Comparación seleccionada: ${selected.daka.name} frente a ${selected.competitor.name}.` : "No hay una comparación seleccionada."}</p>
    <section className="comparison-grid" aria-label="Resultados y detalle de comparación" data-tour="comparison-grid">
      <article className="comparison-table-card" aria-labelledby="comparison-results-title" aria-busy={loading}>
        <div className="section-head"><h2 id="comparison-results-title">Productos comparados</h2><small aria-live="polite">{loading ? "Consultando…" : `Mostrando ${integer.format(items.length)} de ${integer.format(total)}`}</small></div>
        {loading ? <div className="comparison-loading" role="status"><span>Analizando las coincidencias DAKA–{competitor.name}…</span>{Array.from({ length: 4 }, (_, index) => <i key={index}/>)}</div> : items.length === 0 ? <div className="empty-state comparison-empty"><strong>No existen comparaciones con estos criterios.</strong><span>{activeFilters.length ? "Elimina uno o varios filtros para ampliar los resultados." : `Todavía no existen comparaciones confiables entre DAKA y ${competitor.name}.`}</span>{activeFilters.length > 0 && <button type="button" className="secondary-button" onClick={clearFilters}>Limpiar filtros</button>}</div> : <div className="table-scroll" tabIndex={0} aria-label="Tabla desplazable de productos comparados"><table className="comparison-table"><caption className="sr-only">Comparación de precios entre DAKA y {competitor.name}. Selecciona una fila con Enter o barra espaciadora para consultar el detalle.</caption><thead><tr><th scope="col">Producto DAKA</th><th scope="col">DAKA</th><th scope="col">{competitor.name}</th><th scope="col">Diferencia</th><th scope="col">Posición</th></tr></thead><tbody>{items.map((item) => { const direction = gapDirection(item, competitor.name); return <tr key={item.matchId} tabIndex={0} aria-current={selected?.matchId === item.matchId ? "true" : undefined} aria-label={`Comparar ${item.daka.name} con ${item.competitor.name}`} className={selected?.matchId === item.matchId ? "selected-comparison" : ""} onClick={() => setSelected(item)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(item); } }}><td><b>{item.daka.name}</b><small>SAP {item.daka.externalId} · {item.daka.category ?? "Sin categoría"}</small></td><td><strong>{money.format(item.daka.price)}</strong><small>{item.daka.inStock === false ? "Sin stock" : "Disponible"}</small></td><td><strong>{money.format(item.competitor.price)}</strong><small>{item.competitor.externalId}</small></td><td className={item.differenceUsd <= 0 ? "comparison-favorable" : "comparison-unfavorable"}><span className="comparison-direction"><span aria-hidden="true">{direction.symbol}</span> {direction.text}</span><b>{item.differenceUsd > 0 ? "+" : ""}{money.format(item.differenceUsd)}</b><small>{item.differencePct > 0 ? "+" : ""}{item.differencePct.toFixed(1)}%</small></td><td><span className={`position-badge ${item.differenceUsd < 0 ? "daka" : item.differenceUsd > 0 ? "competitor" : "equal"}`}>{positionLabel(item, competitor.name)}</span></td></tr>; })}</tbody></table></div>}
        {items.length > 0 && <div className="changes-load-more">{hasMore ? <button onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "Cargando…" : "Cargar 50 comparaciones más"}</button> : <span>Se mostraron todas las comparaciones</span>}</div>}
      </article>

      <article className="comparison-detail-card" aria-labelledby={selected ? "comparison-detail-title" : undefined} aria-label={selected ? undefined : "Detalle de comparación"}>
        {selected ? <><div className="comparison-detail-head"><span className="eyebrow-dark">Equivalencia detectada</span><h2 id="comparison-detail-title">{selected.daka.name}</h2><p>Confianza {(selected.confidence * 100).toFixed(0)}% · {matchMethodLabel(selected.matchMethod)}</p></div>
          <div className="store-comparison"><div><span className="store-label daka-store">DAKA</span><strong>{money.format(selected.daka.price)}</strong><small>SAP {selected.daka.externalId}</small><small>{selected.daka.inStock === false ? "Sin stock en última captura" : "Disponible en última captura"}</small><a href={selected.daka.url} target="_blank" rel="noreferrer">Abrir producto DAKA ↗</a></div><div><span className={`store-label ${source}-store`}>{competitor.name}</span><strong>{money.format(selected.competitor.price)}</strong>{selected.competitor.listPrice != null && selected.competitor.listPrice > selected.competitor.price && <small>Precio anterior {money.format(selected.competitor.listPrice)}</small>}<small>Ref. {selected.competitor.externalId}</small><small>{selected.competitor.inStock === false ? "No disponible" : selected.competitor.availableQuantity == null ? "Disponible" : `${selected.competitor.availableQuantity} unidades reportadas`}</small><a href={selected.competitor.url} target="_blank" rel="noreferrer">Abrir producto {competitor.name} ↗</a></div></div>
          <div className={`competitive-conclusion ${selected.differenceUsd <= 0 ? "favorable" : "unfavorable"}`}><span>Lectura competitiva</span><strong>{positionLabel(selected, competitor.name)}</strong><p>{selected.differenceUsd === 0 ? "Ambas tiendas presentan el mismo precio." : `La brecha es de ${money.format(Math.abs(selected.differenceUsd))} (${Math.abs(selected.differencePct).toFixed(1)}%) respecto al precio de ${competitor.name}.`}</p></div>
          <div className="comparison-meta"><div><span>Captura DAKA</span><b>{formatDate(selected.daka.scrapedAt)}</b></div><div><span>Captura {competitor.name}</span><b>{formatDate(selected.competitor.scrapedAt)}</b></div></div></> : <div className="empty-state detail-empty">Selecciona una comparación para revisar la equivalencia.</div>}
      </article>
    </section>
    </div>}
    </div>
  </div>;
}
