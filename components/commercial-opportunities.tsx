"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type CompetitorSource = "damasco" | "multimax" | "ivoo" | "venelectronics";
type OpportunityType = "price_risk" | "price_advantage" | "availability_risk" | "availability_advantage" | "stale_data";
type Priority = "critical" | "high" | "medium" | "informative";
type OpportunitySort = "priority" | "competitor_asc" | "competitor_desc" | "gap_usd_desc" | "gap_usd_asc" | "gap_pct_desc" | "gap_pct_asc";

type Signal = {
  type: OpportunityType;
  label: string;
  explanation: string;
  score: number;
  priority: Priority;
  favorable: boolean;
  recentCompetitorDrop: boolean;
};

type StoreProduct = {
  id: number;
  externalId: string;
  name: string;
  brand: string | null;
  category: string | null;
  url: string;
  price: number | null;
  previousPrice: number | null;
  inStock: boolean | null;
  availableQuantity: number | null;
  scrapedAt: string;
};

type OpportunityComparison = {
  matchId: number;
  confidence: number;
  source: CompetitorSource;
  sourceName: string;
  competitor: StoreProduct & { listPrice: number | null };
  differenceUsd: number | null;
  differencePct: number | null;
  fresh: boolean;
  signal: Signal | null;
};

type Opportunity = {
  daka: StoreProduct;
  primary: Signal & {
    source: CompetitorSource;
    sourceName: string;
    differenceUsd: number | null;
    differencePct: number | null;
  };
  comparisons: OpportunityComparison[];
  pressureCount: number;
  detectedAt: string;
};

type OpportunityStats = {
  total: number;
  prioritized: number;
  priceRisks: number;
  priceAdvantages: number;
  availabilityRisks: number;
  availabilityAdvantages: number;
  stale: number;
};

type OpportunityPage = {
  items: Opportunity[];
  total: number;
  hasMore: boolean;
  minimumGap: number;
  stats: OpportunityStats;
  brands: string[];
  categories: string[];
  freshnessHours: number;
  generatedAt: string;
};

const BATCH_SIZE = 50;
const COMPETITORS: Record<CompetitorSource, string> = {
  damasco: "Damasco",
  multimax: "Multimax",
  ivoo: "IVOO",
  venelectronics: "Venelectronics"
};
const EMPTY_STATS: OpportunityStats = {
  total: 0, prioritized: 0, priceRisks: 0, priceAdvantages: 0,
  availabilityRisks: 0, availabilityAdvantages: 0, stale: 0
};
const money = new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD" });
const integer = new Intl.NumberFormat("es-VE");
const vetDate = new Intl.DateTimeFormat("es-VE", {
  timeZone: "America/Caracas", day: "2-digit", month: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit"
});

function formatDate(value: string | null) {
  return value ? `${vetDate.format(new Date(value))} VET` : "Sin captura";
}

function formatPrice(value: number | null) {
  return value == null ? "Sin precio" : money.format(value);
}

function stockLabel(product: Pick<StoreProduct, "inStock" | "availableQuantity">) {
  if (product.inStock === false) return "Sin disponibilidad";
  if (product.inStock == null) return "Disponibilidad no reportada";
  return product.availableQuantity == null ? "Disponible" : `${integer.format(product.availableQuantity)} unidades reportadas`;
}

function priorityLabel(value: Priority) {
  return { critical: "Crítica", high: "Alta", medium: "Media", informative: "Informativa" }[value];
}

export default function CommercialOpportunities({ canAdmin = false }: { canAdmin?: boolean }) {
  const [items, setItems] = useState<Opportunity[]>([]);
  const [selected, setSelected] = useState<Opportunity | null>(null);
  const [stats, setStats] = useState<OpportunityStats>(EMPTY_STATS);
  const [brands, setBrands] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [source, setSource] = useState("all");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [type, setType] = useState("all");
  const [priority, setPriority] = useState("all");
  const [availability, setAvailability] = useState("all");
  const [minimumGap, setMinimumGap] = useState("5");
  const [sort, setSort] = useState<OpportunitySort>("priority");
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [freshnessHours, setFreshnessHours] = useState(48);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportNotice, setReportNotice] = useState<string | null>(null);
  const [telegramSending, setTelegramSending] = useState(false);
  const queryVersion = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [search]);

  const parameters = useCallback((offset: number) => new URLSearchParams({
    limit: String(BATCH_SIZE), offset: String(offset), search: debouncedSearch,
    source, brand, category, type, priority, availability, minimumGap, sort
  }), [availability, brand, category, debouncedSearch, minimumGap, priority, sort, source, type]);

  const reportParameters = useCallback(() => {
    const values = parameters(0);
    values.delete("limit");
    values.delete("offset");
    return values;
  }, [parameters]);

  const sendTelegramPdf = useCallback(async () => {
    setTelegramSending(true);
    setReportNotice(null);
    try {
      const response = await fetch("/api/opportunities/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ searchParams: reportParameters().toString() })
      });
      const payload = await response.json() as { sent?: boolean; total?: number; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No fue posible enviar el reporte");
      setReportNotice(`PDF enviado por Telegram con ${integer.format(payload.total ?? 0)} oportunidades.`);
    } catch (requestError) {
      setReportNotice(requestError instanceof Error ? requestError.message : "No fue posible enviar el reporte");
    } finally {
      setTelegramSending(false);
    }
  }, [reportParameters]);

  const toggleCompetitorSort = () => setSort((current) => current === "competitor_asc" ? "competitor_desc" : "competitor_asc");
  const toggleGapSort = () => setSort((current) => current === "gap_usd_desc" ? "gap_usd_asc" : "gap_usd_desc");

  useEffect(() => {
    const controller = new AbortController();
    const version = ++queryVersion.current;
    setLoading(true);
    setError(null);
    setItems([]);
    setSelected(null);
    setTotal(0);
    setHasMore(false);
    fetch(`/api/opportunities?${parameters(0).toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Centro de oportunidades no disponible");
        return payload as OpportunityPage;
      })
      .then((page) => {
        if (version !== queryVersion.current) return;
        setItems(page.items);
        setStats(page.stats);
        setBrands(page.brands);
        setCategories(page.categories);
        setTotal(page.total);
        setHasMore(page.hasMore);
        setFreshnessHours(page.freshnessHours);
        setGeneratedAt(page.generatedAt);
      })
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        if (version === queryVersion.current) setError(requestError instanceof Error ? requestError.message : "No fue posible calcular las oportunidades");
      })
      .finally(() => { if (version === queryVersion.current) setLoading(false); });
    return () => controller.abort();
  }, [parameters]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loading || loadingMore) return;
    setLoadingMore(true);
    const version = queryVersion.current;
    try {
      const response = await fetch(`/api/opportunities?${parameters(items.length).toString()}`, { cache: "no-store" });
      const page = await response.json() as OpportunityPage & { error?: string };
      if (!response.ok) throw new Error(page.error ?? "No fue posible cargar más oportunidades");
      if (version !== queryVersion.current) return;
      setItems((current) => [...current, ...page.items.filter((item) => !current.some((known) => known.daka.id === item.daka.id))]);
      setTotal(page.total);
      setHasMore(page.hasMore);
      setStats(page.stats);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible cargar más oportunidades");
    } finally {
      if (version === queryVersion.current) setLoadingMore(false);
    }
  }, [hasMore, items.length, loading, loadingMore, parameters]);

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selected]);

  return <section className="commercial-opportunities">
    <header className="opportunity-head">
      <div><span className="eyebrow-dark">Inteligencia accionable · Últimas capturas exitosas</span><h2>Centro de oportunidades comerciales</h2><p>Prioriza señales de precio y disponibilidad sin sustituir la decisión comercial ni asumir rentabilidad.</p></div>
      <div><span>Actualización del análisis</span><strong>{formatDate(generatedAt)}</strong><small>Capturas mayores a {freshnessHours} horas se marcan como informativas.</small></div>
    </header>

    <div className="opportunity-summary">
      <article className="opportunity-priority"><span>Prioridad crítica o alta</span><strong>{loading ? "…" : integer.format(stats.prioritized)}</strong><small>Requieren revisión comercial</small></article>
      <article className="opportunity-risk"><span>Riesgos de precio</span><strong>{loading ? "…" : integer.format(stats.priceRisks)}</strong><small>DAKA ≥ {minimumGap}% por encima</small></article>
      <article className="opportunity-win"><span>Ventajas de precio</span><strong>{loading ? "…" : integer.format(stats.priceAdvantages)}</strong><small>DAKA ≥ {minimumGap}% por debajo</small></article>
      <article className="opportunity-risk"><span>Riesgos de disponibilidad</span><strong>{loading ? "…" : integer.format(stats.availabilityRisks)}</strong><small>Competencia disponible</small></article>
      <article className="opportunity-win"><span>Ventajas de disponibilidad</span><strong>{loading ? "…" : integer.format(stats.availabilityAdvantages)}</strong><small>Competencia sin disponibilidad</small></article>
    </div>

    <div className="opportunity-filters">
      <input aria-label="Buscar oportunidad" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto, SAP, marca o referencia"/>
      <select aria-label="Competidor" value={source} onChange={(event) => { setSource(event.target.value); setBrand(""); setCategory(""); }}><option value="all">Todos los competidores</option>{Object.entries(COMPETITORS).map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}</select>
      <select aria-label="Marca" value={brand} onChange={(event) => setBrand(event.target.value)}><option value="">Todas las marcas</option>{brands.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      <select aria-label="Categoría" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Todas las categorías</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      <select aria-label="Tipo de oportunidad" value={type} onChange={(event) => setType(event.target.value)}><option value="all">Todos los tipos</option><option value="price_risk">Riesgo de precio</option><option value="price_advantage">Ventaja de precio</option><option value="availability_risk">Riesgo de disponibilidad</option><option value="availability_advantage">Ventaja de disponibilidad</option><option value="multi_pressure">Presión multicompetidor</option><option value="stale_data">Datos por actualizar</option></select>
      <select aria-label="Prioridad" value={priority} onChange={(event) => setPriority(event.target.value)}><option value="all">Todas las prioridades</option><option value="critical">Crítica</option><option value="high">Alta</option><option value="medium">Media</option><option value="informative">Informativa</option></select>
      <select aria-label="Disponibilidad" value={availability} onChange={(event) => setAvailability(event.target.value)}><option value="all">Cualquier disponibilidad</option><option value="daka_available">DAKA disponible</option><option value="daka_unavailable">DAKA sin disponibilidad</option><option value="competitor_available">Competidor disponible</option><option value="competitor_unavailable">Competidor sin disponibilidad</option></select>
      <select aria-label="Brecha mínima" value={minimumGap} onChange={(event) => setMinimumGap(event.target.value)}><option value="5">Brecha mínima 5%</option><option value="10">Brecha mínima 10%</option><option value="15">Brecha mínima 15%</option><option value="20">Brecha mínima 20%</option></select>
      <select aria-label="Orden de oportunidades" value={sort} onChange={(event) => setSort(event.target.value as OpportunitySort)}><option value="priority">Prioridad comercial</option><option value="competitor_asc">Competencia A–Z</option><option value="competitor_desc">Competencia Z–A</option><option value="gap_usd_desc">Mayor brecha USD</option><option value="gap_usd_asc">Menor brecha USD</option><option value="gap_pct_desc">Mayor brecha %</option><option value="gap_pct_asc">Menor brecha %</option></select>
    </div>

    <div className="opportunity-actions" aria-label="Acciones del reporte">
      <div><strong>Reporte con los filtros seleccionados</strong><small>Incluye todas las oportunidades encontradas, aunque todavía no estén cargadas en la tabla.</small></div>
      <div>
        <a className="opportunity-export-button" href={`/api/opportunities/export?format=xlsx&${reportParameters().toString()}`}>Descargar Excel</a>
        <a className="opportunity-export-button" href={`/api/opportunities/export?format=pdf&${reportParameters().toString()}`}>Descargar PDF</a>
        {canAdmin && <button className="opportunity-telegram-button" onClick={() => void sendTelegramPdf()} disabled={telegramSending}>{telegramSending ? "Enviando…" : "Enviar PDF por Telegram"}</button>}
      </div>
    </div>
    {reportNotice && <div className="opportunity-report-notice" role="status">{reportNotice}</div>}

    {error && <div className="error-banner"><strong>Análisis pendiente</strong><span>{error}</span></div>}
    {stats.stale > 0 && <div className="opportunity-freshness-warning"><strong>{integer.format(stats.stale)} productos con datos por actualizar</strong><span>No se presentan como oportunidades confirmadas hasta que las fuentes completen una nueva ejecución exitosa.</span></div>}

    <article className="opportunity-table-card">
      <div className="section-head"><div><h2>Oportunidades detectadas</h2><small className="section-explanation">Un producto DAKA aparece una sola vez; el detalle reúne todos sus competidores homologados.</small></div><small>{loading ? "Analizando…" : `Mostrando ${integer.format(items.length)} de ${integer.format(total)}`}</small></div>
      {loading ? <div className="empty-state">Calculando señales comerciales con las últimas capturas exitosas…</div> : items.length === 0 ? <div className="empty-state">No se encontraron oportunidades con los filtros seleccionados.</div> : <div className="table-scroll"><table className="opportunity-table"><thead><tr><th>Prioridad</th><th>Producto DAKA</th><th><button className="opportunity-sort-button" onClick={toggleCompetitorSort}>Competencia principal <span aria-hidden="true">{sort === "competitor_asc" ? "↑" : sort === "competitor_desc" ? "↓" : "↕"}</span></button></th><th>Situación</th><th>Precio DAKA</th><th>Precio competencia</th><th><button className="opportunity-sort-button" onClick={toggleGapSort}>Brecha <span aria-hidden="true">{sort === "gap_usd_asc" ? "↑" : sort === "gap_usd_desc" ? "↓" : "↕"}</span></button></th><th>Disponibilidad</th><th>Detectado</th><th>Detalle</th></tr></thead><tbody>{items.map((item) => {
        const primaryComparison = item.comparisons.find((entry) => entry.source === item.primary.source && entry.signal?.type === item.primary.type)
          ?? item.comparisons.find((entry) => entry.source === item.primary.source)
          ?? item.comparisons[0];
        return <tr key={item.daka.id} className={selected?.daka.id === item.daka.id ? "selected-opportunity" : ""}>
          <td><span className={`opportunity-priority-badge ${item.primary.priority}`}>{priorityLabel(item.primary.priority)}</span></td>
          <td><a href={item.daka.url} target="_blank" rel="noreferrer">{item.daka.name}</a><small>SAP {item.daka.externalId} · {item.daka.brand ?? item.daka.category ?? "Sin clasificación"}</small></td>
          <td><span className={`opportunity-source ${item.primary.source}`}>{item.primary.sourceName}</span><small>{primaryComparison?.competitor.name ?? "Producto homologado"}</small></td>
          <td><strong className={item.primary.favorable ? "opportunity-positive" : "opportunity-negative"}>{item.primary.label}</strong>{item.pressureCount >= 2 && <small>{item.pressureCount} competidores con mejor precio</small>}</td>
          <td><strong>{formatPrice(item.daka.price)}</strong></td>
          <td><strong>{formatPrice(primaryComparison?.competitor.price ?? null)}</strong></td>
          <td className={item.primary.favorable ? "opportunity-positive" : "opportunity-negative"}><strong>{item.primary.differenceUsd == null ? "—" : `${item.primary.differenceUsd > 0 ? "+" : ""}${money.format(item.primary.differenceUsd)}`}</strong><small>{item.primary.differencePct == null ? "Sin comparación" : `${item.primary.differencePct > 0 ? "+" : ""}${item.primary.differencePct.toFixed(1)}%`}</small></td>
          <td><small>DAKA: {stockLabel(item.daka)}</small><small>{item.primary.sourceName}: {primaryComparison ? stockLabel(primaryComparison.competitor) : "No reportada"}</small></td>
          <td>{formatDate(item.detectedAt)}</td>
          <td><button className="opportunity-detail-button" onClick={() => setSelected(item)}>Ver detalle</button></td>
        </tr>;
      })}</tbody></table></div>}
      {items.length > 0 && <div className="changes-load-more">{hasMore ? <button onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "Cargando…" : "Cargar 50 oportunidades más"}</button> : <span>Se mostraron todas las oportunidades encontradas</span>}</div>}
    </article>

    {selected && <div className="opportunity-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
      <aside className="opportunity-drawer" role="dialog" aria-modal="true" aria-labelledby="opportunity-detail-title">
        <header className="opportunity-detail-head"><div><span className="eyebrow-dark">Análisis competitivo</span><h2 id="opportunity-detail-title">{selected.daka.name}</h2><small>SAP {selected.daka.externalId} · {selected.daka.brand ?? selected.daka.category ?? "Sin clasificación"}</small></div><button aria-label="Cerrar detalle" onClick={() => setSelected(null)}>×</button></header>
        <div className="opportunity-drawer-body">
          <div className={`opportunity-conclusion ${selected.primary.favorable ? "favorable" : "unfavorable"}`}><div><span className={`opportunity-priority-badge ${selected.primary.priority}`}>{priorityLabel(selected.primary.priority)}</span><strong>{selected.primary.label}</strong></div><p>{selected.primary.explanation}</p><small>La señal se calcula con precios y disponibilidad; no constituye una recomendación automática de descuento.</small></div>
          <section className="opportunity-daka-card"><div><span className="store-label daka-store">DAKA</span><h3>{selected.daka.name}</h3><small>SAP {selected.daka.externalId}</small></div><div><strong>{formatPrice(selected.daka.price)}</strong>{selected.daka.previousPrice != null && <small>Precio anterior {money.format(selected.daka.previousPrice)}</small>}<small>{stockLabel(selected.daka)}</small><a href={selected.daka.url} target="_blank" rel="noreferrer">Abrir producto DAKA ↗</a></div></section>
          <h3 className="opportunity-comparisons-title">Competidores homologados</h3>
          <div className="opportunity-comparison-list">{selected.comparisons.map((comparison) => <article key={comparison.matchId} className={comparison.signal ? "has-signal" : ""}>
            <div className="opportunity-comparison-title"><span className={`opportunity-source ${comparison.source}`}>{comparison.sourceName}</span>{comparison.signal && <span className={`opportunity-signal ${comparison.signal.favorable ? "favorable" : "unfavorable"}`}>{comparison.signal.label}</span>}</div>
            <h4>{comparison.competitor.name}</h4><small>Ref. {comparison.competitor.externalId} · Homologación {(comparison.confidence * 100).toFixed(0)}%</small>
            <div className="opportunity-comparison-metrics"><div><span>Precio actual</span><strong>{formatPrice(comparison.competitor.price)}</strong></div><div><span>Precio anterior</span><strong>{formatPrice(comparison.competitor.previousPrice)}</strong></div><div><span>Brecha frente a DAKA</span><strong className={(comparison.differenceUsd ?? 0) > 0 ? "opportunity-negative" : "opportunity-positive"}>{comparison.differencePct == null ? "—" : `${comparison.differencePct > 0 ? "+" : ""}${comparison.differencePct.toFixed(1)}%`}</strong></div></div>
            <p>{comparison.signal?.explanation ?? "Sin una brecha igual o superior al umbral seleccionado."}</p><div className="opportunity-comparison-footer"><span>{stockLabel(comparison.competitor)} · {formatDate(comparison.competitor.scrapedAt)}</span><a href={comparison.competitor.url} target="_blank" rel="noreferrer">Abrir producto ↗</a></div>
          </article>)}</div>
        </div>
      </aside>
    </div>}
  </section>;
}
