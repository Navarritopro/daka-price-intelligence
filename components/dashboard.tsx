"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import type { DashboardData, JobSummary, ProductSummary } from "@/lib/types";

type PricePoint = {
  price: number;
  scrapedAt: string;
  previousPrice: number | null;
  differenceUsd: number | null;
  changePct: number | null;
};
type View = "prices" | "operations";
type PriceTab = "explore" | "changes";
type ChangeProduct = ProductSummary & {
  changeCount: number;
  initialPrice: number | null;
  finalPrice: number | null;
  netDifferenceUsd: number | null;
  netChangePct: number | null;
  largestChangePct: number | null;
  latestChangeAt: string | null;
};
type ChangeStats = { productsChanged: number; totalChanges: number; drops: number; increases: number };
type ChangePage = {
  items: ChangeProduct[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  stats: ChangeStats;
};
type MovementPage = {
  items: PricePoint[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};
type ScrapeRequest = {
  id: string;
  status: "queued" | "running" | "success" | "failed";
  requestedAt: string;
  claimedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
};
type ProductPage = {
  items: ProductSummary[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};

const PRODUCT_BATCH_SIZE = 50;
const PRODUCT_LOAD_THRESHOLD = 420;

const money = new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD" });
const integer = new Intl.NumberFormat("es-VE");
const vetDate = new Intl.DateTimeFormat("es-VE", {
  timeZone: "America/Caracas",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

function formatDate(value: string | null | undefined) {
  if (!value) return "Sin registros";
  return `${vetDate.format(new Date(value))} VET`;
}

function formatDuration(seconds: number | null | undefined) {
  if (seconds == null) return "—";
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function changeClass(value: number | null) {
  if (value == null || value === 0) return "neutral";
  return value < 0 ? "negative" : "positive";
}

function chartPath(points: PricePoint[]) {
  if (!points.length) return { line: "", area: "", dots: [] as Array<{ x: number; y: number }> };
  const ordered = [...points].reverse();
  const values = ordered.map((point) => point.price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const dots = ordered.map((point, index) => ({
    x: 45 + (index / Math.max(ordered.length - 1, 1)) * 690,
    y: 190 - ((point.price - min) / range) * 145
  }));
  const line = dots.map((dot, index) => `${index === 0 ? "M" : "L"}${dot.x.toFixed(1)} ${dot.y.toFixed(1)}`).join(" ");
  return { line, area: `${line} L735 210 L45 210 Z`, dots };
}

export default function Dashboard() {
  const [view, setView] = useState<View>("prices");
  const [priceTab, setPriceTab] = useState<PriceTab>("explore");
  const [summary, setSummary] = useState<DashboardData | null>(null);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [latestRequest, setLatestRequest] = useState<ScrapeRequest | null>(null);
  const [selected, setSelected] = useState<ProductSummary | null>(null);
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [changeFilter, setChangeFilter] = useState("all");
  const [productStatus, setProductStatus] = useState("current");
  const [totalProducts, setTotalProducts] = useState(0);
  const [hasMoreProducts, setHasMoreProducts] = useState(false);
  const [productsLoading, setProductsLoading] = useState(true);
  const [loadingMoreProducts, setLoadingMoreProducts] = useState(false);
  const [productLoadError, setProductLoadError] = useState<string | null>(null);
  const [changeProducts, setChangeProducts] = useState<ChangeProduct[]>([]);
  const [changeStats, setChangeStats] = useState<ChangeStats>({ productsChanged: 0, totalChanges: 0, drops: 0, increases: 0 });
  const [changeDays, setChangeDays] = useState("30");
  const [changeMovement, setChangeMovement] = useState("all");
  const [changeThreshold, setChangeThreshold] = useState("0");
  const [changeStatus, setChangeStatus] = useState("current");
  const [changeTotal, setChangeTotal] = useState(0);
  const [hasMoreChanges, setHasMoreChanges] = useState(false);
  const [changesLoading, setChangesLoading] = useState(false);
  const [loadingMoreChanges, setLoadingMoreChanges] = useState(false);
  const [changeLoadError, setChangeLoadError] = useState<string | null>(null);
  const [movements, setMovements] = useState<PricePoint[]>([]);
  const [movementTotal, setMovementTotal] = useState(0);
  const [hasMoreMovements, setHasMoreMovements] = useState(false);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [loadingMoreMovements, setLoadingMoreMovements] = useState(false);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const productListRef = useRef<HTMLDivElement>(null);
  const productQueryVersion = useRef(0);
  const loadingMoreRef = useRef(false);
  const changeQueryVersion = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryResponse, jobsResponse, requestResponse] = await Promise.all([
        fetch("/api/dashboard", { cache: "no-store" }),
        fetch("/api/jobs", { cache: "no-store" }),
        fetch("/api/requests", { cache: "no-store" })
      ]);
      if (!summaryResponse.ok || !jobsResponse.ok || !requestResponse.ok) throw new Error("API unavailable");
      const [summaryData, jobsData, requestData] = await Promise.all([
        summaryResponse.json(), jobsResponse.json(), requestResponse.json()
      ]);
      setSummary(summaryData);
      setJobs(jobsData);
      setLatestRequest(requestData);
    } catch {
      setError("No fue posible cargar la información. Verifica la conexión con PostgreSQL.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (priceTab !== "explore") return;
    const controller = new AbortController();
    const version = ++productQueryVersion.current;
    const params = new URLSearchParams({
      limit: String(PRODUCT_BATCH_SIZE),
      offset: "0",
      search: debouncedSearch,
      change: changeFilter,
      status: productStatus
    });

    setProductsLoading(true);
    setProductLoadError(null);
    setProducts([]);
    setTotalProducts(0);
    setHasMoreProducts(false);
    setSelected(null);
    productListRef.current?.scrollTo({ top: 0 });

    fetch(`/api/products?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Products unavailable")))
      .then((page: ProductPage) => {
        if (version !== productQueryVersion.current) return;
        setProducts(page.items);
        setTotalProducts(page.total);
        setHasMoreProducts(page.hasMore);
        setSelected(page.items[0] ?? null);
      })
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        if (version !== productQueryVersion.current) return;
        setProductLoadError("No fue posible cargar el catálogo. Intenta nuevamente.");
      })
      .finally(() => {
        if (version === productQueryVersion.current) setProductsLoading(false);
      });

    return () => controller.abort();
  }, [debouncedSearch, changeFilter, priceTab, productStatus]);

  const loadMoreProductResults = useCallback(async () => {
    if (loadingMoreRef.current || productsLoading || !hasMoreProducts) return;
    loadingMoreRef.current = true;
    setLoadingMoreProducts(true);
    const version = productQueryVersion.current;
    const params = new URLSearchParams({
      limit: String(PRODUCT_BATCH_SIZE),
      offset: String(products.length),
      search: debouncedSearch,
      change: changeFilter,
      status: productStatus
    });

    try {
      const response = await fetch(`/api/products?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Products unavailable");
      const page: ProductPage = await response.json();
      if (version !== productQueryVersion.current) return;
      setProducts((current) => {
        const known = new Set(current.map((product) => product.id));
        return [...current, ...page.items.filter((product) => !known.has(product.id))];
      });
      setTotalProducts(page.total);
      setHasMoreProducts(page.hasMore);
      setProductLoadError(null);
    } catch {
      if (version === productQueryVersion.current) {
        setProductLoadError("No se pudo cargar el siguiente grupo de productos.");
      }
    } finally {
      if (version === productQueryVersion.current) setLoadingMoreProducts(false);
      loadingMoreRef.current = false;
    }
  }, [changeFilter, debouncedSearch, hasMoreProducts, productStatus, products.length, productsLoading]);

  useEffect(() => {
    if (priceTab !== "changes") return;
    const controller = new AbortController();
    const version = ++changeQueryVersion.current;
    const params = new URLSearchParams({
      limit: String(PRODUCT_BATCH_SIZE),
      offset: "0",
      search: debouncedSearch,
      days: changeDays,
      movement: changeMovement,
      threshold: changeThreshold,
      status: changeStatus
    });

    setChangesLoading(true);
    setChangeLoadError(null);
    setChangeProducts([]);
    setChangeTotal(0);
    setHasMoreChanges(false);
    fetch(`/api/price-changes?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Changes unavailable")))
      .then((page: ChangePage) => {
        if (version !== changeQueryVersion.current) return;
        setChangeProducts(page.items);
        setChangeTotal(page.total);
        setHasMoreChanges(page.hasMore);
        setChangeStats(page.stats);
        setSelected(page.items[0] ?? null);
      })
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        if (version !== changeQueryVersion.current) return;
        setChangeLoadError("No fue posible consultar los cambios de precios.");
      })
      .finally(() => {
        if (version === changeQueryVersion.current) setChangesLoading(false);
      });

    return () => controller.abort();
  }, [changeDays, changeMovement, changeStatus, changeThreshold, debouncedSearch, priceTab]);

  const loadMoreChanges = useCallback(async () => {
    if (loadingMoreChanges || changesLoading || !hasMoreChanges) return;
    setLoadingMoreChanges(true);
    const version = changeQueryVersion.current;
    const params = new URLSearchParams({
      limit: String(PRODUCT_BATCH_SIZE),
      offset: String(changeProducts.length),
      search: debouncedSearch,
      days: changeDays,
      movement: changeMovement,
      threshold: changeThreshold,
      status: changeStatus
    });
    try {
      const response = await fetch(`/api/price-changes?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Changes unavailable");
      const page: ChangePage = await response.json();
      if (version !== changeQueryVersion.current) return;
      setChangeProducts((current) => [...current, ...page.items.filter((item) => !current.some((known) => known.id === item.id))]);
      setChangeTotal(page.total);
      setHasMoreChanges(page.hasMore);
      setChangeStats(page.stats);
    } catch {
      if (version === changeQueryVersion.current) setChangeLoadError("No se pudo cargar el siguiente grupo de cambios.");
    } finally {
      if (version === changeQueryVersion.current) setLoadingMoreChanges(false);
    }
  }, [changeDays, changeMovement, changeProducts.length, changeStatus, changeThreshold, changesLoading, debouncedSearch, hasMoreChanges, loadingMoreChanges]);

  useEffect(() => {
    const hasActiveExecution = latestRequest?.status === "queued" || latestRequest?.status === "running" || jobs[0]?.status === "running";
    if (!hasActiveExecution) return;
    const timer = window.setInterval(async () => {
      try {
        const [jobsResponse, requestResponse] = await Promise.all([
          fetch("/api/jobs", { cache: "no-store" }),
          fetch("/api/requests", { cache: "no-store" })
        ]);
        if (!jobsResponse.ok || !requestResponse.ok) return;
        const [updatedJobs, updatedRequest]: [JobSummary[], ScrapeRequest | null] = await Promise.all([
          jobsResponse.json(), requestResponse.json()
        ]);
        setJobs(updatedJobs);
        setLatestRequest(updatedRequest);
        if (jobs[0]?.status === "running" && updatedJobs[0]?.status !== "running") void load();
      } catch {
        // El siguiente ciclo reintenta automáticamente.
      }
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [jobs[0]?.status, latestRequest?.status, load]);

  useEffect(() => {
    if (!selected) { setHistory([]); return; }
    fetch(`/api/products/${selected.id}/history`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [selected]);

  useEffect(() => {
    if (priceTab !== "changes" || !selected) {
      setMovements([]);
      setMovementTotal(0);
      setHasMoreMovements(false);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({
      limit: String(PRODUCT_BATCH_SIZE),
      offset: "0",
      days: changeDays,
      movement: changeMovement,
      threshold: changeThreshold
    });
    setMovementsLoading(true);
    setMovements([]);
    fetch(`/api/products/${selected.id}/changes?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((page: MovementPage) => {
        setMovements(page.items);
        setMovementTotal(page.total);
        setHasMoreMovements(page.hasMore);
      })
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setMovements([]);
        setMovementTotal(0);
        setHasMoreMovements(false);
      })
      .finally(() => setMovementsLoading(false));
    return () => controller.abort();
  }, [changeDays, changeMovement, changeThreshold, priceTab, selected]);

  const loadMoreMovements = useCallback(async () => {
    if (!selected || loadingMoreMovements || movementsLoading || !hasMoreMovements) return;
    setLoadingMoreMovements(true);
    const params = new URLSearchParams({
      limit: String(PRODUCT_BATCH_SIZE),
      offset: String(movements.length),
      days: changeDays,
      movement: changeMovement,
      threshold: changeThreshold
    });
    try {
      const response = await fetch(`/api/products/${selected.id}/changes?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Movements unavailable");
      const page: MovementPage = await response.json();
      setMovements((current) => [...current, ...page.items]);
      setMovementTotal(page.total);
      setHasMoreMovements(page.hasMore);
    } catch {
      setNotice("No fue posible cargar el siguiente grupo de movimientos.");
      window.setTimeout(() => setNotice(null), 4500);
    } finally {
      setLoadingMoreMovements(false);
    }
  }, [changeDays, changeMovement, changeThreshold, hasMoreMovements, loadingMoreMovements, movements.length, movementsLoading, selected]);

  function handleProductScroll(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - PRODUCT_LOAD_THRESHOLD) {
      void loadMoreProductResults();
    }
  }

  const chart = useMemo(() => chartPath(history), [history]);

  async function triggerScrape() {
    const key = window.prompt("Ingresa la clave administrativa para iniciar el scraping:");
    if (!key) return;
    setRunning(true);
    try {
      const response = await fetch("/api/scrape", { method: "POST", headers: { "x-admin-key": key } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No fue posible iniciar la ejecución");
      setLatestRequest({
        id: String(payload.request.id),
        status: "queued",
        requestedAt: payload.request.requested_at,
        claimedAt: null,
        finishedAt: null,
        errorMessage: null
      });
      setView("operations");
      setNotice("Solicitud registrada. El equipo ejecutor local la iniciará en un máximo de dos minutos.");
      setTimeout(() => void load(), 6000);
    } catch (requestError) {
      setNotice(requestError instanceof Error ? requestError.message : "No fue posible iniciar la ejecución");
    } finally {
      setRunning(false);
      window.setTimeout(() => setNotice(null), 6500);
    }
  }

  const latestJob = jobs[0] ?? null;
  const requestWaiting = latestRequest?.status === "queued";
  const requestPreparing = latestRequest?.status === "running" && latestJob?.status !== "running";
  const executionBusy = running || requestWaiting || requestPreparing || latestJob?.status === "running";
  const previousSuccessfulJob = jobs.find((job, index) => index > 0 && job.status === "success" && job.pagesScanned > 0);
  const expectedPages = previousSuccessfulJob?.pagesScanned ?? 138;
  const expectedProducts = previousSuccessfulJob?.productsFound ?? summary?.productsMonitored ?? 2205;
  const progressPercent = latestJob?.status === "success" ? 100 : latestJob?.status === "running"
    ? latestJob.productsSaved > 0
      ? Math.min(99, Math.round(80 + (latestJob.productsSaved / Math.max(expectedProducts, 1)) * 19))
      : Math.min(80, Math.round((latestJob.pagesScanned / Math.max(expectedPages, 1)) * 80))
    : 0;
  const prices = history.map((point) => point.price);
  const maxPrice = prices.length ? Math.max(...prices) : null;
  const minPrice = prices.length ? Math.min(...prices) : null;
  const selectedChange = changeProducts.find((product) => product.id === selected?.id) ?? null;

  return (
    <div className="app-wrap">
      {notice && <div className="notice" role="status">{notice}</div>}
      <header className="app-header">
        <div className="brand">DAKA <span>PRICE LAB</span></div>
        <nav className="module-nav" aria-label="Módulos principales">
          <button className={view === "prices" ? "module-button active" : "module-button"} onClick={() => setView("prices")}>Inteligencia de precios</button>
          <button className={view === "operations" ? "module-button active" : "module-button"} onClick={() => setView("operations")}>Monitoreo técnico</button>
        </nav>
        <div className="header-actions">
          <span className="next-run">Próxima ejecución · 09:00 AM VET</span>
          <button className="primary-button" onClick={triggerScrape} disabled={executionBusy}>{running ? "Iniciando…" : executionBusy ? "Ejecución pendiente" : "Actualizar datos ahora"}</button>
        </div>
      </header>

      {error && <div className="error-banner"><strong>Conexión pendiente</strong><span>{error}</span><button onClick={() => void load()}>Reintentar</button></div>}

      {view === "prices" ? (
        <main>
          <section className="hero-grid">
            <article className="intro-card"><div className="eyebrow">Inteligencia de precios · Fase 1</div><h1>El histórico del catálogo Daka, en una sola vista.</h1><p>Seguimiento diario en USD, identificación de variaciones y trazabilidad exacta de cada captura.</p></article>
            <div className="hero-stats">
              <article className="stat-card"><span>Catálogo actual</span><strong>{loading ? "…" : integer.format(summary?.productsMonitored ?? 0)}</strong><em>{integer.format(summary?.productsHistorical ?? 0)} históricos · {integer.format(summary?.productsNotSeen ?? 0)} no vistos</em></article>
              <article className="stat-card accent"><span>Oportunidades de rebaja</span><strong>{loading ? "…" : integer.format(summary?.priceDropsToday ?? 0)}</strong><em>Detectadas hoy</em></article>
              <article className="stat-card"><span>Precio promedio</span><strong>{loading ? "…" : money.format(summary?.averagePrice ?? 0)}</strong><em>{summary?.changesToday ?? 0} cambios ≥ ±5%</em></article>
              <article className="stat-card"><span>Último scraping</span><strong>{summary?.lastJobStatus === "success" ? "Exitoso" : summary?.lastJobStatus ?? "Pendiente"}</strong><em>{formatDuration(summary?.lastJobDurationSeconds)} · {formatDate(summary?.lastScrapeAt)}</em></article>
            </div>
          </section>

          <div className="tabs"><button className={priceTab === "explore" ? "tab active" : "tab"} onClick={() => setPriceTab("explore")}>Explorar precios</button><button className={priceTab === "changes" ? "tab active" : "tab"} onClick={() => setPriceTab("changes")}>Cambios de precios</button><button className="tab" onClick={() => { setPriceTab("explore"); setProductStatus("all"); }}>Histórico por producto</button><button className="tab locked" title="Disponible en Fase 2">🔒 Competidores</button></div>
          {priceTab === "explore" ? <>
          <section className="filters"><input aria-label="Buscar producto" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto o código SAP"/><select aria-label="Estado del producto" value={productStatus} onChange={(event) => setProductStatus(event.target.value)}><option value="current">Vigentes en última captura</option><option value="missing">No vistos en última captura</option><option value="all">Todos los históricos</option></select><select aria-label="Variación" value={changeFilter} onChange={(event) => setChangeFilter(event.target.value)}><option value="all">Cualquier variación</option><option value="down">Rebajas</option><option value="up">Aumentos</option><option value="same">Sin cambios</option></select><select aria-label="Período" disabled><option>Últimos 90 días</option></select></section>

          <section className="content-grid">
            <article className="product-list"><div className="section-head"><h2>{productStatus === "current" ? "Catálogo actual" : productStatus === "missing" ? "No vistos en última captura" : "Catálogo histórico"}</h2><small>{productsLoading ? "Consultando catálogo…" : `Mostrando ${integer.format(products.length)} de ${integer.format(totalProducts)}`}</small></div><div className="product-scroll" ref={productListRef} onScroll={handleProductScroll}>
              {productsLoading && <div className="empty-state">Buscando productos en todo el catálogo…</div>}
              {!productsLoading && productLoadError && products.length === 0 && <div className="empty-state product-error">{productLoadError}</div>}
              {!productsLoading && !productLoadError && products.length === 0 && <div className="empty-state">No encontramos productos con ese nombre o código SAP.</div>}
              {products.map((product, index) => <button key={product.id} aria-posinset={index + 1} aria-setsize={totalProducts} className={selected?.id === product.id ? "product-row active" : "product-row"} onClick={() => setSelected(product)}><div><b>{product.name}</b><p>{product.externalId} · {product.category ?? "Sin categoría"}</p>{!product.seenInLatest && <span className="product-status-badge">No visto en última captura</span>}</div><div className="product-price"><strong>{product.currentPrice == null ? "Sin precio" : money.format(product.currentPrice)}</strong><span className={`variation ${changeClass(product.changePct)}`}>{product.changePct == null ? "—" : `${product.changePct > 0 ? "+" : ""}${product.changePct.toFixed(1)}%`}</span></div></button>)}
              {products.length > 0 && <div className="product-load-state">{loadingMoreProducts ? "Cargando más productos…" : hasMoreProducts ? "Desplázate para continuar cargando" : "Se mostraron todos los productos"}{productLoadError && products.length > 0 ? ` · ${productLoadError}` : ""}</div>}
            </div></article>
            <article className="detail-card">
              {selected ? <><div className="detail-main"><div className="detail-title"><div><h2>{selected.name}</h2><div className="meta"><span className="source-badge">D</span> Tiendas Daka · SAP {selected.externalId}</div>{!selected.seenInLatest && <div className="product-missing-notice">No fue visto en la última captura. Se muestra su último precio histórico.</div>}</div><div className="current-price"><span className="meta">{selected.seenInLatest ? "Precio actual" : "Último precio registrado"}</span><strong>{selected.currentPrice == null ? "Sin precio" : money.format(selected.currentPrice)}</strong><span className={`variation ${changeClass(selected.changePct)}`}>{selected.changePct == null ? "Sin comparación" : `${selected.changePct > 0 ? "+" : ""}${selected.changePct.toFixed(1)}% vs. captura anterior`}</span></div></div>
                {history.length ? <svg className="price-chart" viewBox="0 0 760 245" role="img" aria-label="Histórico de precio"><defs><linearGradient id="priceArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1258d9" stopOpacity=".2"/><stop offset="1" stopColor="#1258d9" stopOpacity="0"/></linearGradient></defs><line className="chart-grid" x1="45" y1="45" x2="735" y2="45"/><line className="chart-grid" x1="45" y1="115" x2="735" y2="115"/><line className="chart-grid" x1="45" y1="190" x2="735" y2="190"/><path className="chart-area" d={chart.area}/><path className="chart-line" d={chart.line}/>{chart.dots.slice(-1).map((dot) => <circle key="last" className="chart-point" cx={dot.x} cy={dot.y} r="5"/>)}</svg> : <div className="chart-empty">El gráfico aparecerá después de la primera captura.</div>}
                <div className="mini-grid"><div><span>Precio máximo</span><b>{maxPrice == null ? "—" : money.format(maxPrice)}</b></div><div><span>Precio mínimo</span><b>{minPrice == null ? "—" : money.format(minPrice)}</b></div><div><span>Capturas</span><b>{history.length} registros</b></div><div><span>Última captura</span><b>{formatDate(selected.scrapedAt)}</b></div></div></div>
                <div className="history-table"><div className="section-head"><h2>Últimas capturas</h2><small>Fecha y hora exactas · VET</small></div><div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Precio USD</th><th>Diferencia USD</th><th>Variación</th></tr></thead><tbody>{history.slice(0, 10).map((point) => <tr key={point.scrapedAt}><td>{formatDate(point.scrapedAt)}</td><td>{money.format(point.price)}</td><td className={changeClass(point.differenceUsd)}>{point.differenceUsd == null ? "—" : `${point.differenceUsd > 0 ? "+" : ""}${money.format(point.differenceUsd)}`}</td><td className={changeClass(point.changePct)}>{point.changePct == null ? "—" : `${point.changePct > 0 ? "+" : ""}${point.changePct.toFixed(1)}%`}</td></tr>)}</tbody></table></div></div></> : <div className="empty-state detail-empty">Selecciona un producto para consultar su histórico.</div>}
            </article>
          </section>
          </> : <>
            <section className="filters change-filters"><input aria-label="Buscar producto con cambios" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto o código SAP"/><select aria-label="Período de cambios" value={changeDays} onChange={(event) => setChangeDays(event.target.value)}><option value="1">Hoy</option><option value="7">Últimos 7 días</option><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option><option value="all">Todo el histórico</option></select><select aria-label="Tipo de movimiento" value={changeMovement} onChange={(event) => setChangeMovement(event.target.value)}><option value="all">Aumentos y rebajas</option><option value="down">Solo rebajas</option><option value="up">Solo aumentos</option></select><select aria-label="Magnitud mínima" value={changeThreshold} onChange={(event) => setChangeThreshold(event.target.value)}><option value="0">Cualquier magnitud</option><option value="5">Cambios ≥ 5%</option><option value="10">Cambios ≥ 10%</option><option value="20">Cambios ≥ 20%</option></select><select aria-label="Estado del catálogo" value={changeStatus} onChange={(event) => setChangeStatus(event.target.value)}><option value="current">Productos vigentes</option><option value="missing">No vistos actualmente</option><option value="all">Todos los históricos</option></select></section>
            <section className="changes-summary"><article><span>Productos con cambios</span><strong>{changesLoading ? "…" : integer.format(changeStats.productsChanged)}</strong></article><article><span>Movimientos registrados</span><strong>{changesLoading ? "…" : integer.format(changeStats.totalChanges)}</strong></article><article className="drop"><span>Rebajas</span><strong>{changesLoading ? "…" : integer.format(changeStats.drops)}</strong></article><article className="rise"><span>Aumentos</span><strong>{changesLoading ? "…" : integer.format(changeStats.increases)}</strong></article></section>
            <section className="changes-grid">
              <article className="changes-table-card"><div className="section-head"><h2>Cambios encontrados</h2><small>{changesLoading ? "Consultando histórico…" : `Mostrando ${integer.format(changeProducts.length)} de ${integer.format(changeTotal)} productos`}</small></div>
                {changesLoading ? <div className="empty-state">Analizando las capturas del período…</div> : changeLoadError && changeProducts.length === 0 ? <div className="empty-state product-error">{changeLoadError}</div> : changeProducts.length === 0 ? <div className="empty-state">No se encontraron cambios con estos filtros.</div> : <div className="table-scroll"><table className="changes-table"><thead><tr><th>Producto</th><th>Cambios</th><th>Precio inicial → final</th><th>Diferencia</th><th>Último cambio</th></tr></thead><tbody>{changeProducts.map((product) => <tr key={product.id} className={selected?.id === product.id ? "selected-change" : ""} onClick={() => setSelected(product)}><td><b>{product.name}</b><small>{product.externalId}</small></td><td><strong>{product.changeCount}</strong><small>movimientos</small></td><td>{product.initialPrice == null || product.finalPrice == null ? "—" : `${money.format(product.initialPrice)} → ${money.format(product.finalPrice)}`}</td><td className={changeClass(product.netDifferenceUsd)}><b>{product.netDifferenceUsd == null ? "—" : `${product.netDifferenceUsd > 0 ? "+" : ""}${money.format(product.netDifferenceUsd)}`}</b><small>{product.netChangePct == null ? "" : `${product.netChangePct > 0 ? "+" : ""}${product.netChangePct.toFixed(1)}% acumulado`}</small></td><td>{formatDate(product.latestChangeAt)}</td></tr>)}</tbody></table></div>}
                {changeProducts.length > 0 && <div className="changes-load-more">{hasMoreChanges ? <button onClick={() => void loadMoreChanges()} disabled={loadingMoreChanges}>{loadingMoreChanges ? "Cargando…" : "Cargar 50 productos más"}</button> : <span>Se mostraron todos los productos con cambios</span>}</div>}
              </article>
              <article className="change-detail-card">
                {selectedChange ? <><div className="change-detail-head"><div><span className="eyebrow-dark">Detalle del período</span><h2>{selectedChange.name}</h2><p>SAP {selectedChange.externalId} · {selectedChange.changeCount} cambios {changeDays === "1" ? "durante el día" : changeDays === "all" ? "en todo el histórico" : `en ${changeDays} días`}</p></div><div className={changeClass(selectedChange.netDifferenceUsd)}><strong>{selectedChange.netDifferenceUsd == null ? "—" : `${selectedChange.netDifferenceUsd > 0 ? "+" : ""}${money.format(selectedChange.netDifferenceUsd)}`}</strong><span>{selectedChange.netChangePct == null ? "Sin comparación" : `${selectedChange.netChangePct > 0 ? "+" : ""}${selectedChange.netChangePct.toFixed(1)}% acumulado`}</span></div></div>
                  {history.length > 0 && <><div className="chart-caption">Gráfico de las últimas 90 capturas · la tabla conserva todos los movimientos</div><svg className="price-chart change-chart" viewBox="0 0 760 245" role="img" aria-label="Evolución histórica del precio"><line className="chart-grid" x1="45" y1="45" x2="735" y2="45"/><line className="chart-grid" x1="45" y1="115" x2="735" y2="115"/><line className="chart-grid" x1="45" y1="190" x2="735" y2="190"/><path className="chart-line" d={chart.line}/>{chart.dots.map((dot, index) => <circle key={index} className="chart-point" cx={dot.x} cy={dot.y} r="4"/>)}</svg></>}
                  <div className="history-table"><div className="section-head"><h2>Movimientos individuales</h2><small>{movementsLoading ? "Consultando…" : `Mostrando ${integer.format(movements.length)} de ${integer.format(movementTotal)}`}</small></div>{movementsLoading ? <div className="empty-state">Cargando movimientos…</div> : <><div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Precio anterior</th><th>Precio nuevo</th><th>Diferencia USD</th><th>Variación</th></tr></thead><tbody>{movements.map((point) => <tr key={point.scrapedAt}><td>{formatDate(point.scrapedAt)}</td><td>{point.previousPrice == null ? "—" : money.format(point.previousPrice)}</td><td>{money.format(point.price)}</td><td className={changeClass(point.differenceUsd)}>{point.differenceUsd == null ? "—" : `${point.differenceUsd > 0 ? "+" : ""}${money.format(point.differenceUsd)}`}</td><td className={changeClass(point.changePct)}>{point.changePct == null ? "—" : `${point.changePct > 0 ? "+" : ""}${point.changePct.toFixed(1)}%`}</td></tr>)}</tbody></table></div><div className="changes-load-more">{hasMoreMovements ? <button onClick={() => void loadMoreMovements()} disabled={loadingMoreMovements}>{loadingMoreMovements ? "Cargando…" : "Cargar 50 movimientos más"}</button> : <span>{movementTotal ? "Se mostraron todos los movimientos del período" : "No existen movimientos con estos filtros"}</span>}</div></>}</div></> : <div className="empty-state detail-empty">Selecciona un producto para visualizar todos sus movimientos.</div>}
              </article>
            </section>
          </>}
          <section className="roadmap"><div><strong>Preparado para crecer hacia el benchmarking competitivo</strong><span>La estructura admite nuevas tiendas sin perder el histórico de Daka.</span></div><div className="stages"><span className="stage">Fase 1 · Daka</span><span>→</span><span className="stage future">Fase 2 · Competidores</span><span>→</span><span className="stage future">Comparador</span></div></section>
        </main>
      ) : (
        <main className="operations-shell">
          <section className="operations-top"><div><div className={`service-status ${latestJob?.status === "failed" ? "failed" : ""}`}>{requestWaiting ? "Solicitud esperando al equipo local" : requestPreparing ? "Preparando el scraper" : latestJob?.status === "running" ? "Scraping en ejecución" : latestJob?.status === "failed" ? "Última ejecución fallida" : "Servicio operativo"}</div><h1>Monitoreo técnico</h1><p>Seguimiento del proceso de extracción, persistencia y alertas.</p></div><button className="primary-button operations-run" onClick={triggerScrape} disabled={executionBusy}>▶ {executionBusy ? "Ejecución pendiente" : "Iniciar ejecución manual"}</button></section>
          {(requestWaiting || requestPreparing) && <section className="live-progress queue-progress"><div><strong>{requestWaiting ? "Solicitud enviada" : "Solicitud recibida"}</strong><span>{requestWaiting ? "Esperando al receptor local" : "Preparando navegador y conexión"}</span></div><progress/><small>{requestWaiting ? `Solicitud #${latestRequest?.id} registrada ${formatDate(latestRequest?.requestedAt)} · puede tardar hasta dos minutos en comenzar.` : "El equipo local tomó la solicitud. El progreso aparecerá en unos segundos."}</small></section>}
          {latestJob?.status === "running" && <section className="live-progress"><div><strong>Ejecución en curso</strong><span>{progressPercent}% estimado · actualización automática cada 10 segundos</span></div><progress value={progressPercent} max="100"/><small>{latestJob.productsSaved > 0 ? `Guardando histórico: ${integer.format(latestJob.productsSaved)} de ${integer.format(expectedProducts)} productos` : `Extrayendo catálogo: ${latestJob.pagesScanned} de aproximadamente ${expectedPages} páginas · ${integer.format(latestJob.productsFound)} productos encontrados`}</small></section>}
          <section className="operations-metrics"><article><span>Productos extraídos</span><strong>{latestJob?.productsFound ?? 0}</strong><em>{latestJob?.status === "success" ? "✓ Proceso completado" : latestJob?.status ?? "Sin ejecuciones"}</em></article><article><span>Guardados con SAP</span><strong>{latestJob?.productsSaved ?? 0}</strong><em>Histórico persistido</em></article><article><span>Sin código SAP</span><strong>{latestJob?.productsWithoutSku ?? 0}</strong><em className="warning">Requiere revisión</em></article><article><span>Páginas</span><strong>{latestJob?.pagesScanned ?? 0}</strong><em>Procesadas</em></article><article><span>Duración</span><strong>{formatDuration(latestJob?.durationSeconds)}</strong><em>{latestJob?.status === "running" ? "Tiempo transcurrido" : "Última ejecución"}</em></article></section>
          <section className="operations-grid"><article className="operations-panel"><div className="operations-head"><h2>Estado de la última ejecución</h2><small>{latestJob ? `Job #${latestJob.id.slice(0, 13)}` : "Sin ejecuciones"}</small></div><div className="pipeline"><div className={`step ${latestJob?.status === "running" && latestJob.pagesScanned === 0 ? "active" : ""}`}><i>{latestJob ? "✓" : "…"}</i><div><span>Inicialización</span><small>Conexión, job y navegador</small></div></div><div className={`step ${latestJob?.status === "running" && latestJob.productsSaved === 0 ? "active" : latestJob?.status !== "success" ? "pending" : ""}`}><i>{latestJob?.status === "success" || (latestJob?.productsSaved ?? 0) > 0 ? "✓" : "…"}</i><div><span>Extracción del catálogo</span><small>{latestJob?.pagesScanned ?? 0} páginas procesadas</small></div></div><div className={`step ${latestJob?.status === "running" && latestJob.productsFound > 0 && latestJob.productsSaved === 0 ? "active" : latestJob?.status !== "success" ? "pending" : ""}`}><i>{latestJob?.status === "success" || (latestJob?.productsSaved ?? 0) > 0 ? "✓" : "…"}</i><div><span>Normalización y validación</span><small>Precios USD y códigos SAP</small></div></div><div className={`step ${latestJob?.status === "running" && latestJob.productsSaved > 0 ? "active" : latestJob?.status !== "success" ? "pending" : ""}`}><i>{latestJob?.status === "success" ? "✓" : "…"}</i><div><span>Persistencia y alertas</span><small>{latestJob?.productsSaved ?? 0} productos guardados</small></div></div></div></article>
          <article className="operations-panel"><div className="operations-head"><h2>Registro de actividad</h2><small>Hora Venezuela</small></div><div className="terminal">{latestJob?.logs?.length ? latestJob.logs.map((log, index) => <div key={`${log.time}-${index}`}><span className={log.level}>{log.time}</span> {log.message}</div>) : <div><span className="info">[SISTEMA]</span> Esperando la primera ejecución…</div>}{latestJob?.errorMessage && <div><span className="error">[ERROR]</span> {latestJob.errorMessage}</div>}</div></article></section>
          <section className="operations-lower"><article className="operations-panel"><div className="operations-head"><h2>Historial de ejecuciones</h2><small>Últimos 20 procesos</small></div><div className="table-scroll"><table className="operations-table"><thead><tr><th>Job</th><th>Inicio exacto</th><th>Origen</th><th>Productos</th><th>Duración</th><th>Resultado</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td>{job.id.slice(0, 13)}</td><td>{formatDate(job.startedAt)}</td><td>{job.triggerType}</td><td>{job.productsSaved}</td><td>{formatDuration(job.durationSeconds)}</td><td><span className={`job-badge ${job.status}`}>{job.status.toUpperCase()}</span></td></tr>)}</tbody></table></div></article><article className="operations-panel"><div className="operations-head"><h2>Configuración activa</h2><small>Fase 1</small></div><div className="operations-config"><div><span>Fuente</span><b>Tiendas Daka</b></div><div><span>Frecuencia</span><b>Todos los días</b></div><div><span>Hora</span><b>09:00 AM VET</b></div><div><span>Alerta mínima</span><b>±5%</b></div><div><span>Canales</span><b>Correo · Telegram</b></div></div></article></section>
        </main>
      )}
    </div>
  );
}
