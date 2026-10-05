"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import CompetitorAvailability, { type AvailabilitySource } from "@/components/competitor-availability";
import type { ProductSummary } from "@/lib/types";

type CatalogTab = "explore" | "changes" | "availability";
type PricePoint = {
  price: number | null;
  listPrice: number | null;
  scrapedAt: string;
  previousPrice: number | null;
  differenceUsd: number | null;
  changePct: number | null;
  inStock: boolean | null;
  availableQuantity: number | null;
};
type ProductPage = { items: ProductSummary[]; total: number; hasMore: boolean; brands: string[] };
type CapturePage = { items: PricePoint[]; total: number; hasMore: boolean; minPrice?: number | null; maxPrice?: number | null; changeCount?: number };
type ChangeProduct = ProductSummary & {
  changeCount: number; initialPrice: number | null; finalPrice: number | null;
  netDifferenceUsd: number | null; netChangePct: number | null;
  largestChangePct: number | null; latestChangeAt: string | null;
};
type ChangePage = {
  items: ChangeProduct[]; total: number; hasMore: boolean;
  stats: { productsChanged: number; totalChanges: number; drops: number; increases: number };
  brands: string[];
};
type Summary = {
  source: string; productsCurrent: number; productsHistorical: number; productsNotSeen: number;
  productsWithPrice: number; productsInStock: number; productsOutOfStock: number;
  averagePrice: number; lastScrapeAt: string | null; lastJobStatus: string | null;
  lastJobDurationSeconds: number | null; categories: string[]; brands: string[];
};

const BATCH_SIZE = 50;
const LOAD_THRESHOLD = 420;
type CompetitorSource = "damasco" | "multimax" | "ivoo" | "venelectronics";
type ReportComparison = { source: string; currentJob: string; previousJob: string };
const SOURCES: Record<CompetitorSource, { name: string; short: string }> = {
  damasco: { name: "Damasco", short: "D" },
  multimax: { name: "Multimax", short: "MM" },
  ivoo: { name: "IVOO", short: "IV" },
  venelectronics: { name: "Venelectronics", short: "VE" },
};
const money = new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD" });
const integer = new Intl.NumberFormat("es-VE");
const vetDate = new Intl.DateTimeFormat("es-VE", {
  timeZone: "America/Caracas", day: "2-digit", month: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit", second: "2-digit"
});

function formatDate(value: string | null | undefined) {
  return value ? `${vetDate.format(new Date(value))} VET` : "Sin registros";
}

function changeClass(value: number | null) {
  if (value == null || value === 0) return "neutral";
  return value < 0 ? "negative" : "positive";
}

function chartPath(points: PricePoint[]) {
  const usable = points.filter((point): point is PricePoint & { price: number } => point.price != null).slice(0, 90).reverse();
  if (!usable.length) return { line: "", area: "", dots: [] as Array<{ x: number; y: number; price: number; scrapedAt: string }> };
  const values = usable.map((point) => point.price);
  const min = Math.min(...values), max = Math.max(...values), range = Math.max(max - min, 1);
  const dots = usable.map((point, index) => ({
    x: 45 + (index / Math.max(usable.length - 1, 1)) * 690,
    y: 190 - ((point.price - min) / range) * 145,
    price: point.price,
    scrapedAt: point.scrapedAt
  }));
  const line = dots.map((dot, index) => `${index ? "L" : "M"}${dot.x.toFixed(1)} ${dot.y.toFixed(1)}`).join(" ");
  return { line, area: `${line} L735 210 L45 210 Z`, dots };
}

export default function DamascoCatalog({ reportComparison = null }: { reportComparison?: ReportComparison | null }) {
  const [source, setSource] = useState<CompetitorSource>("damasco");
  const [availabilitySource, setAvailabilitySource] = useState<AvailabilitySource>("all");
  const { name: sourceName, short: sourceShort } = SOURCES[source];
  const [tab, setTab] = useState<CatalogTab>("explore");
  const [historyMode, setHistoryMode] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("current");
  const [change, setChange] = useState("all");
  const [stock, setStock] = useState("all");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [productTotal, setProductTotal] = useState(0);
  const [productHasMore, setProductHasMore] = useState(false);
  const [productLoading, setProductLoading] = useState(true);
  const [productLoadingMore, setProductLoadingMore] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ProductSummary | null>(null);
  const [captures, setCaptures] = useState<PricePoint[]>([]);
  const [captureTotal, setCaptureTotal] = useState(0);
  const [captureHasMore, setCaptureHasMore] = useState(false);
  const [historicalMinPrice, setHistoricalMinPrice] = useState<number | null>(null);
  const [historicalMaxPrice, setHistoricalMaxPrice] = useState<number | null>(null);
  const [captureChangeCount, setCaptureChangeCount] = useState(0);
  const [captureLoading, setCaptureLoading] = useState(false);
  const [captureLoadingMore, setCaptureLoadingMore] = useState(false);
  const [days, setDays] = useState("30");
  const [movement, setMovement] = useState("all");
  const [threshold, setThreshold] = useState("0");
  const [changeStatus, setChangeStatus] = useState("current");
  const [changeProducts, setChangeProducts] = useState<ChangeProduct[]>([]);
  const [changeTotal, setChangeTotal] = useState(0);
  const [changeHasMore, setChangeHasMore] = useState(false);
  const [changeLoading, setChangeLoading] = useState(false);
  const [changeLoadingMore, setChangeLoadingMore] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [changeStats, setChangeStats] = useState({ productsChanged: 0, totalChanges: 0, drops: 0, increases: 0 });
  const [movements, setMovements] = useState<PricePoint[]>([]);
  const [movementTotal, setMovementTotal] = useState(0);
  const [movementHasMore, setMovementHasMore] = useState(false);
  const [movementLoading, setMovementLoading] = useState(false);
  const [movementLoadingMore, setMovementLoadingMore] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const productVersion = useRef(0);
  const changeVersion = useRef(0);
  const loadingMoreRef = useRef(false);
  const activeReportComparison = reportComparison?.source === source ? reportComparison : null;

  useEffect(() => {
    if (!reportComparison || !Object.prototype.hasOwnProperty.call(SOURCES, reportComparison.source)) return;
    setSource(reportComparison.source as CompetitorSource);
    setTab("changes");
  }, [reportComparison]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setSummary(null); setSummaryError(null);
    fetch(`/api/catalog-summary?source=${source}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(setSummary)
      .catch(() => setSummaryError(`No fue posible cargar el resumen de ${sourceName}.`));
  }, [source, sourceName]);

  const productParams = useCallback((offset: number) => new URLSearchParams({
    source, limit: String(BATCH_SIZE), offset: String(offset), search: debouncedSearch,
    status, change, stock, category, brand
  }), [brand, category, change, debouncedSearch, source, status, stock]);

  useEffect(() => {
    if (tab !== "explore") return;
    const controller = new AbortController();
    const version = ++productVersion.current;
    setProductLoading(true); setProductError(null); setProducts([]); setProductTotal(0);
    setProductHasMore(false); setSelected(null); listRef.current?.scrollTo({ top: 0 });
    fetch(`/api/products?${productParams(0)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const page = await response.json();
        if (!response.ok) throw new Error(page.error ?? "Catálogo no disponible");
        return page as ProductPage;
      })
      .then((page) => {
        if (version !== productVersion.current) return;
        setProducts(page.items); setProductTotal(page.total); setProductHasMore(page.hasMore);
        setSelected(page.items[0] ?? null);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (version === productVersion.current) setProductError(`No fue posible cargar el catálogo ${sourceName}.`);
      })
      .finally(() => { if (version === productVersion.current) setProductLoading(false); });
    return () => controller.abort();
  }, [productParams, sourceName, tab]);

  const loadMoreProducts = useCallback(async () => {
    if (loadingMoreRef.current || productLoading || !productHasMore) return;
    loadingMoreRef.current = true; setProductLoadingMore(true);
    const version = productVersion.current;
    try {
      const response = await fetch(`/api/products?${productParams(products.length)}`, { cache: "no-store" });
      const page = await response.json() as ProductPage & { error?: string };
      if (!response.ok) throw new Error(page.error ?? "No fue posible cargar más productos");
      if (version !== productVersion.current) return;
      setProducts((current) => [...current, ...page.items.filter((item) => !current.some((known) => known.id === item.id))]);
      setProductTotal(page.total); setProductHasMore(page.hasMore); setProductError(null);
    } catch { if (version === productVersion.current) setProductError("No se pudo cargar el siguiente bloque."); }
    finally { loadingMoreRef.current = false; if (version === productVersion.current) setProductLoadingMore(false); }
  }, [productHasMore, productLoading, productParams, products.length]);

  useEffect(() => {
    if (!selected) { setCaptures([]); setCaptureTotal(0); setCaptureHasMore(false); setHistoricalMinPrice(null); setHistoricalMaxPrice(null); setCaptureChangeCount(0); return; }
    const controller = new AbortController();
    setCaptureLoading(true); setCaptures([]);
    fetch(`/api/products/${selected.id}/captures?limit=${BATCH_SIZE}&offset=0`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((page: CapturePage) => { setCaptures(page.items); setCaptureTotal(page.total); setCaptureHasMore(page.hasMore); setHistoricalMinPrice(page.minPrice ?? null); setHistoricalMaxPrice(page.maxPrice ?? null); setCaptureChangeCount(page.changeCount ?? 0); })
      .catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) { setCaptures([]); setCaptureTotal(0); } })
      .finally(() => setCaptureLoading(false));
    return () => controller.abort();
  }, [selected]);

  const loadMoreCaptures = useCallback(async () => {
    if (!selected || captureLoading || captureLoadingMore || !captureHasMore) return;
    setCaptureLoadingMore(true);
    try {
      const response = await fetch(`/api/products/${selected.id}/captures?limit=${BATCH_SIZE}&offset=${captures.length}`, { cache: "no-store" });
      const page = await response.json() as CapturePage;
      if (!response.ok) throw new Error();
      setCaptures((current) => [...current, ...page.items]); setCaptureTotal(page.total); setCaptureHasMore(page.hasMore); setCaptureChangeCount(page.changeCount ?? 0);
    } catch {
      setProductError("No fue posible cargar el siguiente bloque del histórico.");
    } finally { setCaptureLoadingMore(false); }
  }, [captureHasMore, captureLoading, captureLoadingMore, captures.length, selected]);

  const changeParams = useCallback((offset: number) => {
    const params = new URLSearchParams({
      source, limit: String(BATCH_SIZE), offset: String(offset), search: debouncedSearch,
      days, movement, threshold, status: changeStatus, brand
    });
    if (activeReportComparison) {
      params.set("currentJob", activeReportComparison.currentJob);
      params.set("previousJob", activeReportComparison.previousJob);
    }
    return params;
  }, [activeReportComparison, brand, changeStatus, days, debouncedSearch, movement, source, threshold]);

  useEffect(() => {
    if (tab !== "changes") return;
    const controller = new AbortController();
    const version = ++changeVersion.current;
    setChangeLoading(true); setChangeError(null); setChangeProducts([]); setChangeTotal(0); setSelected(null);
    fetch(`/api/price-changes?${changeParams(0)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const page = await response.json();
        if (!response.ok) throw new Error(page.error ?? "Cambios no disponibles");
        return page as ChangePage;
      })
      .then((page) => {
        if (version !== changeVersion.current) return;
        setChangeProducts(page.items); setChangeTotal(page.total); setChangeHasMore(page.hasMore);
        setChangeStats(page.stats); setSelected(page.items[0] ?? null);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (version === changeVersion.current) setChangeError(`No fue posible consultar los cambios de ${sourceName}.`);
      })
      .finally(() => { if (version === changeVersion.current) setChangeLoading(false); });
    return () => controller.abort();
  }, [changeParams, sourceName, tab]);

  const loadMoreChangeProducts = useCallback(async () => {
    if (changeLoading || changeLoadingMore || !changeHasMore) return;
    setChangeLoadingMore(true); const version = changeVersion.current;
    try {
      const response = await fetch(`/api/price-changes?${changeParams(changeProducts.length)}`, { cache: "no-store" });
      const page = await response.json() as ChangePage;
      if (!response.ok) throw new Error();
      if (version !== changeVersion.current) return;
      setChangeProducts((current) => [...current, ...page.items.filter((item) => !current.some((known) => known.id === item.id))]);
      setChangeTotal(page.total); setChangeHasMore(page.hasMore); setChangeStats(page.stats);
    } catch { if (version === changeVersion.current) setChangeError("No se pudo cargar el siguiente bloque de cambios."); }
    finally { if (version === changeVersion.current) setChangeLoadingMore(false); }
  }, [changeHasMore, changeLoading, changeLoadingMore, changeParams, changeProducts.length]);

  useEffect(() => {
    if (tab !== "changes" || !selected) { setMovements([]); setMovementTotal(0); setMovementHasMore(false); return; }
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: String(BATCH_SIZE), offset: "0", days, movement, threshold });
    setMovementLoading(true); setMovements([]);
    fetch(`/api/products/${selected.id}/changes?${params}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((page: CapturePage) => { setMovements(page.items); setMovementTotal(page.total); setMovementHasMore(page.hasMore); })
      .catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) setMovements([]); })
      .finally(() => setMovementLoading(false));
    return () => controller.abort();
  }, [days, movement, selected, tab, threshold]);

  const loadMoreMovements = useCallback(async () => {
    if (!selected || movementLoading || movementLoadingMore || !movementHasMore) return;
    setMovementLoadingMore(true);
    const params = new URLSearchParams({ limit: String(BATCH_SIZE), offset: String(movements.length), days, movement, threshold });
    try {
      const response = await fetch(`/api/products/${selected.id}/changes?${params}`, { cache: "no-store" });
      const page = await response.json() as CapturePage;
      if (!response.ok) throw new Error();
      setMovements((current) => [...current, ...page.items]); setMovementTotal(page.total); setMovementHasMore(page.hasMore);
    } catch {
      setChangeError("No fue posible cargar el siguiente bloque de movimientos.");
    } finally { setMovementLoadingMore(false); }
  }, [days, movement, movementHasMore, movementLoading, movementLoadingMore, movements.length, selected, threshold]);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - LOAD_THRESHOLD) void loadMoreProducts();
  }

  function openCatalog() {
    setHistoryMode(false);
    setTab("explore");
    setStatus("current");
  }

  function openProductHistory(product?: ProductSummary) {
    setHistoryMode(true);
    setTab("explore");
    setStatus("all");
    setChange("all");
    setStock("all");
    setCategory("");
    setBrand("");
    if (product) setSearch(product.externalId);
  }

  const chart = useMemo(() => chartPath(captures), [captures]);
  const selectedChange = changeProducts.find((product) => product.id === selected?.id) ?? null;
  const latestCapture = captures[0] ?? null;

  return <section className="damasco-catalog">
    <nav className="competitor-source-tabs" aria-label="Catálogo competidor">{tab === "availability" && <><button className={availabilitySource === "all" ? "active" : ""} onClick={() => setAvailabilitySource("all")}>Todos</button><button className={availabilitySource === "daka" ? "active" : ""} onClick={() => setAvailabilitySource("daka")}>DAKA</button></>}{(Object.entries(SOURCES) as [CompetitorSource, { name: string; short: string }][]).map(([slug, item]) => <button key={slug} className={(tab === "availability" ? availabilitySource : source) === slug ? "active" : ""} onClick={() => { if (tab === "availability") setAvailabilitySource(slug); else { setSource(slug); setCategory(""); setBrand(""); } }}>{item.name}</button>)}</nav>
    {tab !== "availability" && <><div className="damasco-catalog-head"><div><span className="eyebrow-dark">Inteligencia competitiva · Catálogo completo</span><h2>Productos e histórico de {sourceName}</h2><p>Consulta todo el catálogo scrapeado aunque el producto todavía no esté homologado con DAKA.</p></div><div><span>Última captura</span><strong>{formatDate(summary?.lastScrapeAt)}</strong></div></div>
    {summaryError && <div className="error-banner"><strong>Resumen pendiente</strong><span>{summaryError}</span></div>}
    <div className="damasco-summary">
      <article><span>Catálogo actual</span><strong>{summary ? integer.format(summary.productsCurrent) : "…"}</strong><small>{integer.format(summary?.productsHistorical ?? 0)} históricos</small></article>
      <article><span>No vistos</span><strong>{summary ? integer.format(summary.productsNotSeen) : "…"}</strong><small>Ausentes en última captura</small></article>
      <article className="stock-ok"><span>Disponibles</span><strong>{summary ? integer.format(summary.productsInStock) : "…"}</strong><small>Con stock reportado</small></article>
      <article className="stock-out"><span>Sin stock</span><strong>{summary ? integer.format(summary.productsOutOfStock) : "…"}</strong><small>Última captura</small></article>
      <article><span>Precio promedio</span><strong>{summary ? money.format(summary.averagePrice) : "…"}</strong><small>{integer.format(summary?.productsWithPrice ?? 0)} con precio</small></article>
    </div></>}
    <div className="source-tabs"><button className={tab === "explore" && !historyMode ? "active" : ""} onClick={openCatalog}>Explorar catálogo</button><button className={tab === "changes" ? "active" : ""} onClick={() => { setHistoryMode(false); setTab("changes"); }}>Cambios de precios</button><button className={tab === "explore" && historyMode ? "active" : ""} onClick={() => openProductHistory()}>Histórico por producto</button><button className={tab === "availability" ? "active" : ""} onClick={() => { setHistoryMode(false); setTab("availability"); }}>Cambios de disponibilidad</button></div>
    {tab === "explore" ? <>
      {historyMode && <div className="history-mode-banner"><div><strong>Histórico completo de {sourceName}</strong><span>Consulta todas las capturas del producto, incluyendo registros donde el precio no cambió.</span></div><button onClick={openCatalog}>Volver al catálogo actual</button></div>}
      <div className="filters damasco-filters"><input aria-label={`Buscar en ${sourceName}`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto, referencia, marca o modelo"/><select aria-label="Marca" value={brand} onChange={(event) => setBrand(event.target.value)}><option value="">Todas las marcas</option>{summary?.brands.map((value) => <option key={value} value={value}>{value}</option>)}</select><select value={category} disabled={historyMode} onChange={(event) => setCategory(event.target.value)}><option value="">Todas las categorías</option>{summary?.categories.map((value) => <option key={value} value={value}>{value}</option>)}</select><select value={status} disabled={historyMode} onChange={(event) => setStatus(event.target.value)}><option value="current">Vigentes en última captura</option><option value="missing">No vistos actualmente</option><option value="all">Todos los históricos</option></select><select value={stock} disabled={historyMode} onChange={(event) => setStock(event.target.value)}><option value="all">Cualquier disponibilidad</option><option value="in">Con stock</option><option value="out">Sin stock</option></select><select value={change} onChange={(event) => setChange(event.target.value)}><option value="all">Cualquier variación</option><option value="down">Rebajas</option><option value="up">Aumentos</option><option value="same">Sin cambios</option></select></div>
      <div className="content-grid">
        <article className="product-list"><div className="section-head"><h2>{historyMode ? `Productos con histórico · ${sourceName}` : `Catálogo ${sourceName}`}</h2><small>{productLoading ? "Consultando…" : `Mostrando ${integer.format(products.length)} de ${integer.format(productTotal)}`}</small></div><div className="product-scroll" ref={listRef} onScroll={handleScroll}>{productLoading ? <div className="empty-state">Buscando en todo el catálogo {sourceName}…</div> : productError && !products.length ? <div className="empty-state product-error">{productError}</div> : !products.length ? <div className="empty-state">No se encontraron productos con estos filtros.</div> : products.map((product, index) => <button key={product.id} aria-posinset={index + 1} aria-setsize={productTotal} className={selected?.id === product.id ? "product-row active" : "product-row"} onClick={() => setSelected(product)}><div><b>{product.name}</b><p>{product.externalId} · {product.brand ?? product.category ?? "Sin clasificación"}</p>{!product.seenInLatest && <span className="product-status-badge">No visto en última captura</span>}</div><div className="product-price"><strong>{product.currentPrice == null ? "Sin precio" : money.format(product.currentPrice)}</strong><span className={`variation ${changeClass(product.changePct)}`}>{product.changePct == null ? "—" : `${product.changePct > 0 ? "+" : ""}${product.changePct.toFixed(1)}%`}</span><small className={product.inStock === false ? "stock-label out" : "stock-label"}>{product.inStock === false ? "Sin stock" : "Disponible"}</small></div></button>)}{products.length > 0 && <div className="product-load-state">{productLoadingMore ? "Cargando más productos…" : productHasMore ? "Desplázate para continuar" : "Se mostraron todos los productos"}</div>}</div></article>
        <article className="detail-card">{selected ? <><div className="detail-main"><div className="detail-title"><div><h2>{selected.name}</h2><div className="meta"><span className={`source-badge ${source}-source`}>{sourceShort}</span> {sourceName} · Ref. {selected.externalId}</div><div className="product-tags">{selected.brand && <span>{selected.brand}</span>}{selected.model && <span>Modelo {selected.model}</span>}{selected.category && <span>{selected.category}</span>}</div>{!selected.seenInLatest && <div className="product-missing-notice">No fue visto en la última captura. Se conserva su último registro histórico.</div>}</div><div className="current-price"><span className="meta">{selected.seenInLatest ? "Precio publicado" : "Último precio registrado"}</span><strong>{selected.currentPrice == null ? "Sin precio" : money.format(selected.currentPrice)}</strong>{selected.listPrice != null && selected.currentPrice != null && selected.listPrice > selected.currentPrice && <span className="list-price">Antes {money.format(selected.listPrice)}</span>}<span className={`variation ${changeClass(selected.changePct)}`}>{selected.changePct == null ? "Sin comparación" : `${selected.changePct > 0 ? "+" : ""}${selected.changePct.toFixed(1)}% vs. captura anterior`}</span><span className={selected.inStock === false ? "availability out" : "availability"}>{selected.inStock === false ? "No disponible" : selected.availableQuantity == null ? "Disponible" : `${selected.availableQuantity} unidades reportadas`}</span></div></div>
          {historyMode && latestCapture && <div className="price-comparison-strip"><div><span>Precio anterior</span><strong>{latestCapture.previousPrice == null ? "Sin comparación" : money.format(latestCapture.previousPrice)}</strong></div><span className="comparison-arrow">→</span><div><span>Precio actual</span><strong>{latestCapture.price == null ? "Sin precio" : money.format(latestCapture.price)}</strong></div><div className={changeClass(latestCapture.differenceUsd)}><span>Último movimiento</span><strong>{latestCapture.differenceUsd == null ? "Sin variación" : `${latestCapture.differenceUsd > 0 ? "+" : ""}${money.format(latestCapture.differenceUsd)}`}</strong><small>{latestCapture.changePct == null ? "" : `${latestCapture.changePct > 0 ? "+" : ""}${latestCapture.changePct.toFixed(1)}%`}</small></div></div>}
          {captureLoading ? <div className="chart-empty">Cargando histórico…</div> : chart.line ? <svg className="price-chart" viewBox="0 0 760 245" role="img" aria-label={`Histórico de precio ${sourceName}`}><defs><linearGradient id="damascoArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#712b93" stopOpacity=".2"/><stop offset="1" stopColor="#712b93" stopOpacity="0"/></linearGradient></defs><line className="chart-grid" x1="45" y1="45" x2="735" y2="45"/><line className="chart-grid" x1="45" y1="115" x2="735" y2="115"/><line className="chart-grid" x1="45" y1="190" x2="735" y2="190"/><path className="chart-area damasco-area" d={chart.area}/><path className="chart-line damasco-line" d={chart.line}/>{(historyMode ? chart.dots : chart.dots.slice(-1)).map((dot, index) => <circle key={`${dot.scrapedAt}-${index}`} className="chart-point damasco-point" cx={dot.x} cy={dot.y} r={historyMode ? "4" : "5"}><title>{`${formatDate(dot.scrapedAt)} · ${money.format(dot.price)}`}</title></circle>)}</svg> : <div className="chart-empty">El gráfico aparecerá después de almacenar más capturas.</div>}
          <div className={historyMode ? "history-metrics-grid" : "mini-grid"}><div><span>Precio máximo histórico</span><b>{historicalMaxPrice == null ? "—" : money.format(historicalMaxPrice)}</b></div><div><span>Precio mínimo histórico</span><b>{historicalMinPrice == null ? "—" : money.format(historicalMinPrice)}</b></div><div><span>Capturas totales</span><b>{integer.format(captureTotal)} registros</b></div>{historyMode && <div><span>Cambios reales</span><b>{integer.format(captureChangeCount)}</b></div>}<div><span>Última captura</span><b>{formatDate(selected.scrapedAt)}</b></div></div><a className="product-external-link" href={selected.url} target="_blank" rel="noreferrer">Abrir producto en {sourceName} ↗</a></div>
          <div className="history-table"><div className="section-head"><h2>{historyMode ? "Todas las capturas del producto" : "Histórico completo de capturas"}</h2><small>Mostrando {integer.format(captures.length)} de {integer.format(captureTotal)}{historyMode ? " · incluye capturas sin variación" : ""}</small></div><div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Precio anterior</th><th>Precio actual</th><th>Precio lista</th><th>Diferencia</th><th>Variación</th><th>Disponibilidad</th><th>Unidades reportadas</th></tr></thead><tbody>{captures.map((point) => <tr key={point.scrapedAt}><td>{formatDate(point.scrapedAt)}</td><td>{point.previousPrice == null ? "—" : money.format(point.previousPrice)}</td><td>{point.price == null ? "—" : money.format(point.price)}</td><td>{point.listPrice == null ? "—" : money.format(point.listPrice)}</td><td className={changeClass(point.differenceUsd)}>{point.differenceUsd == null ? "—" : `${point.differenceUsd > 0 ? "+" : ""}${money.format(point.differenceUsd)}`}</td><td className={changeClass(point.changePct)}>{point.changePct == null ? "—" : `${point.changePct > 0 ? "+" : ""}${point.changePct.toFixed(1)}%`}</td><td>{point.inStock == null ? "No reportada" : point.inStock ? "Disponible" : "Sin stock"}</td><td>{point.availableQuantity == null ? "No reportadas" : integer.format(point.availableQuantity)}</td></tr>)}</tbody></table></div><div className="changes-load-more">{captureHasMore ? <button onClick={() => void loadMoreCaptures()} disabled={captureLoadingMore}>{captureLoadingMore ? "Cargando…" : "Cargar 50 capturas más"}</button> : <span>{captureTotal ? "Se mostró todo el histórico almacenado" : "Sin capturas"}</span>}</div></div></> : <div className="empty-state detail-empty">Selecciona un producto para consultar su histórico.</div>}</article>
      </div>
    </> : tab === "changes" ? <>
      {activeReportComparison && <div className="report-comparison-banner"><strong>Comparación del reporte de Telegram</strong><span>Se muestran exclusivamente las variaciones entre las dos capturas indicadas en la notificación de {sourceName}.</span></div>}
      <div className="filters change-filters"><input aria-label={`Buscar cambios ${sourceName}`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto, referencia, marca o modelo"/><select aria-label="Marca" value={brand} onChange={(event) => setBrand(event.target.value)}><option value="">Todas las marcas</option>{summary?.brands.map((value) => <option key={value} value={value}>{value}</option>)}</select><select value={activeReportComparison ? "report" : days} disabled={Boolean(activeReportComparison)} onChange={(event) => setDays(event.target.value)}>{activeReportComparison && <option value="report">Capturas del reporte</option>}<option value="1">Hoy</option><option value="7">Últimos 7 días</option><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option><option value="all">Todo el histórico</option></select><select value={movement} onChange={(event) => setMovement(event.target.value)}><option value="all">Aumentos y rebajas</option><option value="down">Solo rebajas</option><option value="up">Solo aumentos</option></select><select value={threshold} onChange={(event) => setThreshold(event.target.value)}><option value="0">Cualquier magnitud</option><option value="5">Cambios ≥ 5%</option><option value="10">Cambios ≥ 10%</option><option value="20">Cambios ≥ 20%</option></select><select value={changeStatus} disabled={Boolean(activeReportComparison)} onChange={(event) => setChangeStatus(event.target.value)}><option value="current">Productos vigentes</option><option value="missing">No vistos actualmente</option><option value="all">Todos los históricos</option></select></div>
      <div className="changes-summary"><article><span>Productos con cambios</span><strong>{changeLoading ? "…" : integer.format(changeStats.productsChanged)}</strong></article><article><span>Movimientos registrados</span><strong>{changeLoading ? "…" : integer.format(changeStats.totalChanges)}</strong></article><article className="drop"><span>Rebajas</span><strong>{changeLoading ? "…" : integer.format(changeStats.drops)}</strong></article><article className="rise"><span>Aumentos</span><strong>{changeLoading ? "…" : integer.format(changeStats.increases)}</strong></article></div>
      <div className="changes-grid"><article className="changes-table-card"><div className="section-head"><h2>Cambios de precios {sourceName}</h2><small>{changeLoading ? "Analizando…" : `Mostrando ${integer.format(changeProducts.length)} de ${integer.format(changeTotal)}`}</small></div>{changeLoading ? <div className="empty-state">Analizando las capturas del período…</div> : changeError && !changeProducts.length ? <div className="empty-state product-error">{changeError}</div> : !changeProducts.length ? <div className="empty-state">Todavía no existen cambios con estos filtros.</div> : <div className="table-scroll"><table className="changes-table"><thead><tr><th>Producto</th><th>Cambios</th><th>Precio inicial → final</th><th>Diferencia</th><th>Último cambio</th></tr></thead><tbody>{changeProducts.map((product) => <tr key={product.id} className={selected?.id === product.id ? "selected-change" : ""} onClick={() => setSelected(product)}><td><b>{product.name}</b><small>{product.externalId} · {product.brand ?? sourceName}</small></td><td><strong>{product.changeCount}</strong><small>movimientos</small></td><td>{product.initialPrice == null || product.finalPrice == null ? "—" : `${money.format(product.initialPrice)} → ${money.format(product.finalPrice)}`}</td><td className={changeClass(product.netDifferenceUsd)}><b>{product.netDifferenceUsd == null ? "—" : `${product.netDifferenceUsd > 0 ? "+" : ""}${money.format(product.netDifferenceUsd)}`}</b><small>{product.netChangePct == null ? "" : `${product.netChangePct > 0 ? "+" : ""}${product.netChangePct.toFixed(1)}% acumulado`}</small></td><td>{formatDate(product.latestChangeAt)}</td></tr>)}</tbody></table></div>}<div className="changes-load-more">{changeHasMore ? <button onClick={() => void loadMoreChangeProducts()} disabled={changeLoadingMore}>{changeLoadingMore ? "Cargando…" : "Cargar 50 productos más"}</button> : changeProducts.length ? <span>Se mostraron todos los productos con cambios</span> : null}</div></article>
        <article className="change-detail-card">{selectedChange ? <><div className="change-detail-head"><div><span className="eyebrow-dark">Histórico competitivo</span><h2>{selectedChange.name}</h2><p>Ref. {selectedChange.externalId} · {selectedChange.changeCount} cambios {days === "all" ? "en todo el histórico" : days === "1" ? "durante el día" : `en ${days} días`}</p><button className="history-link-button" onClick={() => openProductHistory(selectedChange)}>Ver todas las capturas del producto</button></div><div className={changeClass(selectedChange.netDifferenceUsd)}><strong>{selectedChange.netDifferenceUsd == null ? "—" : `${selectedChange.netDifferenceUsd > 0 ? "+" : ""}${money.format(selectedChange.netDifferenceUsd)}`}</strong><span>{selectedChange.netChangePct == null ? "Sin comparación" : `${selectedChange.netChangePct > 0 ? "+" : ""}${selectedChange.netChangePct.toFixed(1)}% acumulado`}</span></div></div>{chart.line && <><div className="chart-caption">Evolución de las capturas guardadas · coloca el cursor sobre un punto para ver su fecha y precio</div><svg className="price-chart change-chart" viewBox="0 0 760 245" role="img" aria-label={`Evolución del precio ${sourceName}`}><line className="chart-grid" x1="45" y1="45" x2="735" y2="45"/><line className="chart-grid" x1="45" y1="115" x2="735" y2="115"/><line className="chart-grid" x1="45" y1="190" x2="735" y2="190"/><path className="chart-line damasco-line" d={chart.line}/>{chart.dots.map((dot, index) => <circle key={`${dot.scrapedAt}-${index}`} className="chart-point damasco-point" cx={dot.x} cy={dot.y} r="4"><title>{`${formatDate(dot.scrapedAt)} · ${money.format(dot.price)}`}</title></circle>)}</svg><div className="mini-grid change-history-summary"><div><span>Precio máximo histórico</span><b>{historicalMaxPrice == null ? "—" : money.format(historicalMaxPrice)}</b></div><div><span>Precio mínimo histórico</span><b>{historicalMinPrice == null ? "—" : money.format(historicalMinPrice)}</b></div><div><span>Capturas guardadas</span><b>{integer.format(captureTotal)}</b></div><div><span>Cambios del período</span><b>{integer.format(selectedChange.changeCount)}</b></div></div></>}<div className="history-table"><div className="section-head"><div><h2>Historial de cambios de precio</h2><small className="section-explanation">Solo se muestran las capturas donde el precio cambió.</small></div><small>{movementLoading ? "Consultando…" : `Mostrando ${integer.format(movements.length)} de ${integer.format(movementTotal)}`}</small></div>{movementLoading ? <div className="empty-state">Cargando movimientos…</div> : <><div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Precio anterior</th><th>Precio nuevo</th><th>Diferencia</th><th>Variación</th></tr></thead><tbody>{movements.map((point) => <tr key={point.scrapedAt}><td>{formatDate(point.scrapedAt)}</td><td>{point.previousPrice == null ? "—" : money.format(point.previousPrice)}</td><td>{point.price == null ? "—" : money.format(point.price)}</td><td className={changeClass(point.differenceUsd)}>{point.differenceUsd == null ? "—" : `${point.differenceUsd > 0 ? "+" : ""}${money.format(point.differenceUsd)}`}</td><td className={changeClass(point.changePct)}>{point.changePct == null ? "—" : `${point.changePct > 0 ? "+" : ""}${point.changePct.toFixed(1)}%`}</td></tr>)}</tbody></table></div><div className="changes-load-more">{movementHasMore ? <button onClick={() => void loadMoreMovements()} disabled={movementLoadingMore}>{movementLoadingMore ? "Cargando…" : "Cargar 50 movimientos más"}</button> : <span>{movementTotal ? "Se mostraron todos los cambios reales del período" : "No existen cambios en el período"}</span>}</div></>}</div></> : <div className="empty-state detail-empty">Selecciona un producto para consultar sus movimientos.</div>}</article></div>
    </> : <CompetitorAvailability source={availabilitySource}/>}
  </section>;
}
