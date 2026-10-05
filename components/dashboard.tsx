"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import type { DashboardData, JobsResponse, JobSummary, MonitoringSourceSummary, ProductSummary } from "@/lib/types";
import CompetitorComparison from "@/components/competitor-comparison";
import CommercialOpportunities from "@/components/commercial-opportunities";
import DamascoCatalog from "@/components/damasco-catalog";
import TechnicalMonitoring from "@/components/technical-monitoring";
import SessionControls from "@/components/session-controls";

type PricePoint = {
  price: number | null;
  scrapedAt: string;
  previousPrice: number | null;
  differenceUsd: number | null;
  changePct: number | null;
  inStock?: boolean | null;
  availableQuantity?: number | null;
};
type CapturePage = {
  items: PricePoint[];
  total: number;
  hasMore: boolean;
  minPrice: number | null;
  maxPrice: number | null;
  changeCount: number;
};
type View = "prices" | "operations";
type PriceTab = "explore" | "changes" | "damasco" | "competitors" | "opportunities";
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
type ReportComparison = { source: string; currentJob: string; previousJob: string };
type ChangePage = {
  items: ChangeProduct[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  stats: ChangeStats;
  brands: string[];
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
  brands: string[];
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

function jobStatusLabel(status: string | null | undefined) {
  const labels: Record<string, string> = { success: "Exitosa", failed: "Fallida", running: "En ejecución", pending: "Pendiente", queued: "En cola" };
  return status ? labels[status] ?? status : "Pendiente";
}

function changeClass(value: number | null) {
  if (value == null || value === 0) return "neutral";
  return value < 0 ? "negative" : "positive";
}

function chartPath(points: PricePoint[]) {
  const ordered = points.filter((point): point is PricePoint & { price: number } => point.price != null).reverse();
  if (!ordered.length) return { line: "", area: "", dots: [] as Array<{ x: number; y: number; price: number; scrapedAt: string }> };
  const values = ordered.map((point) => point.price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const dots = ordered.map((point, index) => ({
    x: 45 + (index / Math.max(ordered.length - 1, 1)) * 690,
    y: 190 - ((point.price - min) / range) * 145,
    price: point.price,
    scrapedAt: point.scrapedAt
  }));
  const line = dots.map((dot, index) => `${index === 0 ? "M" : "L"}${dot.x.toFixed(1)} ${dot.y.toFixed(1)}`).join(" ");
  return { line, area: `${line} L735 210 L45 210 Z`, dots };
}

export default function Dashboard() {
  const [view, setView] = useState<View>("prices");
  const [priceTab, setPriceTab] = useState<PriceTab>("explore");
  const [historyMode, setHistoryMode] = useState(false);
  const [summary, setSummary] = useState<DashboardData | null>(null);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [monitoringSources, setMonitoringSources] = useState<MonitoringSourceSummary[]>([]);
  const [latestRequest, setLatestRequest] = useState<ScrapeRequest | null>(null);
  const [selected, setSelected] = useState<ProductSummary | null>(null);
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyMinPrice, setHistoryMinPrice] = useState<number | null>(null);
  const [historyMaxPrice, setHistoryMaxPrice] = useState<number | null>(null);
  const [historyChangeCount, setHistoryChangeCount] = useState(0);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [changeFilter, setChangeFilter] = useState("all");
  const [brandFilter, setBrandFilter] = useState("");
  const [brands, setBrands] = useState<string[]>([]);
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
  const [reportSending, setReportSending] = useState(false);
  const [currentRole, setCurrentRole] = useState<"admin" | "viewer" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reportComparison, setReportComparison] = useState<ReportComparison | null>(null);
  const productListRef = useRef<HTMLDivElement>(null);
  const productQueryVersion = useRef(0);
  const loadingMoreRef = useRef(false);
  const changeQueryVersion = useRef(0);

  const resetProductScroll = useCallback(() => {
    const reset = () => productListRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    reset();
    window.requestAnimationFrame(reset);
  }, []);

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
      const [summaryData, jobsData, requestData]: [DashboardData, JobsResponse, ScrapeRequest | null] = await Promise.all([
        summaryResponse.json(), jobsResponse.json(), requestResponse.json()
      ]);
      setSummary(summaryData);
      setJobs(jobsData.items);
      setMonitoringSources(jobsData.sources);
      setLatestRequest(requestData);
    } catch {
      setError("No fue posible cargar la información. Verifica la conexión con PostgreSQL.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("priceTab") === "opportunities") {
      setHistoryMode(false);
      setPriceTab("opportunities");
    }
    const source = params.get("source") ?? "";
    const currentJob = params.get("currentJob") ?? "";
    const previousJob = params.get("previousJob") ?? "";
    if (!currentJob || !previousJob || !["daka", "damasco", "multimax", "ivoo", "venelectronics"].includes(source)) return;
    setReportComparison({ source, currentJob, previousJob });
    setPriceTab(source === "daka" ? "changes" : "damasco");
  }, []);

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
    params.set("brand", brandFilter);

    setProductsLoading(true);
    setProductLoadError(null);
    setProducts([]);
    setTotalProducts(0);
    setHasMoreProducts(false);
    setSelected(null);
    resetProductScroll();

    fetch(`/api/products?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Products unavailable")))
      .then((page: ProductPage) => {
        if (version !== productQueryVersion.current) return;
        setProducts(page.items);
        setTotalProducts(page.total);
        setHasMoreProducts(page.hasMore);
        setBrands(page.brands ?? []);
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
  }, [brandFilter, debouncedSearch, changeFilter, priceTab, productStatus, resetProductScroll]);

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
    params.set("brand", brandFilter);

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
  }, [brandFilter, changeFilter, debouncedSearch, hasMoreProducts, productStatus, products.length, productsLoading]);

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
    params.set("brand", brandFilter);
    if (reportComparison?.source === "daka") {
      params.set("currentJob", reportComparison.currentJob);
      params.set("previousJob", reportComparison.previousJob);
    }

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
        setBrands(page.brands ?? []);
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
  }, [brandFilter, changeDays, changeMovement, changeStatus, changeThreshold, debouncedSearch, priceTab, reportComparison]);

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
    params.set("brand", brandFilter);
    if (reportComparison?.source === "daka") {
      params.set("currentJob", reportComparison.currentJob);
      params.set("previousJob", reportComparison.previousJob);
    }
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
  }, [brandFilter, changeDays, changeMovement, changeProducts.length, changeStatus, changeThreshold, changesLoading, debouncedSearch, hasMoreChanges, loadingMoreChanges, reportComparison]);

  useEffect(() => {
    const hasActiveExecution = latestRequest?.status === "queued" || latestRequest?.status === "running" || jobs.some((job) => job.status === "running");
    if (!hasActiveExecution) return;
    const timer = window.setInterval(async () => {
      try {
        const [jobsResponse, requestResponse] = await Promise.all([
          fetch("/api/jobs", { cache: "no-store" }),
          fetch("/api/requests", { cache: "no-store" })
        ]);
        if (!jobsResponse.ok || !requestResponse.ok) return;
        const [updatedJobs, updatedRequest]: [JobsResponse, ScrapeRequest | null] = await Promise.all([
          jobsResponse.json(), requestResponse.json()
        ]);
        setJobs(updatedJobs.items);
        setMonitoringSources(updatedJobs.sources);
        setLatestRequest(updatedRequest);
        if (jobs.some((job) => job.status === "running") && !updatedJobs.items.some((job) => job.status === "running")) void load();
      } catch {
        // El siguiente ciclo reintenta automáticamente.
      }
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [jobs, latestRequest?.status, load]);

  useEffect(() => {
    if (!selected) {
      setHistory([]); setHistoryTotal(0); setHistoryHasMore(false);
      setHistoryMinPrice(null); setHistoryMaxPrice(null); setHistoryChangeCount(0);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/products/${selected.id}/captures?limit=100&offset=0`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((page: CapturePage) => {
        setHistory(page.items); setHistoryTotal(page.total); setHistoryHasMore(page.hasMore);
        setHistoryMinPrice(page.minPrice); setHistoryMaxPrice(page.maxPrice); setHistoryChangeCount(page.changeCount);
      })
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setHistory([]); setHistoryTotal(0); setHistoryHasMore(false);
      });
    return () => controller.abort();
  }, [selected]);

  const loadMoreHistory = useCallback(async () => {
    if (!selected || historyLoadingMore || !historyHasMore) return;
    setHistoryLoadingMore(true);
    try {
      const response = await fetch(`/api/products/${selected.id}/captures?limit=100&offset=${history.length}`, { cache: "no-store" });
      if (!response.ok) throw new Error("History unavailable");
      const page: CapturePage = await response.json();
      setHistory((current) => [...current, ...page.items]);
      setHistoryTotal(page.total); setHistoryHasMore(page.hasMore);
      setHistoryMinPrice(page.minPrice); setHistoryMaxPrice(page.maxPrice); setHistoryChangeCount(page.changeCount);
    } catch {
      setNotice("No fue posible cargar el siguiente grupo de capturas.");
      window.setTimeout(() => setNotice(null), 4500);
    } finally {
      setHistoryLoadingMore(false);
    }
  }, [history.length, historyHasMore, historyLoadingMore, selected]);

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

  function openExplorePrices() {
    resetProductScroll();
    setHistoryMode(false);
    setPriceTab("explore");
    setProductStatus("current");
  }

  function openProductHistory(product?: ProductSummary) {
    resetProductScroll();
    setHistoryMode(true);
    setPriceTab("explore");
    setProductStatus("all");
    setChangeFilter("all");
    if (product) setSearch(product.externalId);
  }

  const chart = useMemo(() => chartPath(history), [history]);

  async function triggerScrape() {
    setRunning(true);
    try {
      const response = await fetch("/api/scrape", { method: "POST" });
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

  async function sendTelegramReport() {
    setReportSending(true);
    try {
      const response = await fetch("/api/telegram-report", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No fue posible solicitar el reporte");
      setNotice("Reporte solicitado. GitHub lo generará y lo enviará por Telegram en unos segundos.");
    } catch (requestError) {
      setNotice(requestError instanceof Error ? requestError.message : "No fue posible solicitar el reporte");
    } finally {
      setReportSending(false);
      window.setTimeout(() => setNotice(null), 6500);
    }
  }

  const latestDakaJob = jobs.find((job) => job.source === "daka") ?? null;
  const requestWaiting = latestRequest?.status === "queued";
  const requestPreparing = latestRequest?.status === "running" && latestDakaJob?.status !== "running";
  const executionBusy = running || requestWaiting || requestPreparing || latestDakaJob?.status === "running";
  const maxPrice = historyMaxPrice;
  const minPrice = historyMinPrice;
  const latestCapture = history[0] ?? null;
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
          <span className="next-run">Competidores · 09:07–09:33 AM VET</span>
          {currentRole === "admin" && <button className="primary-button" onClick={triggerScrape} disabled={executionBusy}>{running ? "Iniciando…" : executionBusy ? "Ejecución pendiente" : "Actualizar datos ahora"}</button>}
          <SessionControls onRole={setCurrentRole}/>
        </div>
      </header>

      {error && <div className="error-banner"><strong>Conexión pendiente</strong><span>{error}</span><button onClick={() => void load()}>Reintentar</button></div>}

      {view === "prices" ? (
        <main>
          <section className="hero-grid">
            <article className="intro-card"><div className="eyebrow">Inteligencia de precios · Fases 1 y 2</div><h1>El mercado y el histórico de DAKA, en una sola vista.</h1><p>Seguimiento diario en USD, variaciones históricas y comparación competitiva con homologación auditable.</p></article>
            <div className="hero-stats">
              <article className="stat-card"><span>Catálogo actual</span><strong>{loading ? "…" : integer.format(summary?.productsMonitored ?? 0)}</strong><em>{integer.format(summary?.productsHistorical ?? 0)} históricos · {integer.format(summary?.productsNotSeen ?? 0)} no vistos</em></article>
              <article className="stat-card accent"><span>Oportunidades de rebaja</span><strong>{loading ? "…" : integer.format(summary?.priceDropsToday ?? 0)}</strong><em>Detectadas hoy</em></article>
              <article className="stat-card"><span>Precio promedio</span><strong>{loading ? "…" : money.format(summary?.averagePrice ?? 0)}</strong><em>{summary?.changesToday ?? 0} cambios ≥ ±5%</em></article>
              <article className="stat-card"><span>Última ejecución DAKA</span><strong>{jobStatusLabel(summary?.lastJobStatus)}</strong><em>{formatDuration(summary?.lastJobDurationSeconds)} · {formatDate(summary?.lastJobAt)}</em><small>Última captura exitosa: {formatDate(summary?.lastScrapeAt)}</small></article>
            </div>
          </section>

          <div className="tabs"><button className={priceTab === "explore" && !historyMode ? "tab active" : "tab"} onClick={openExplorePrices}>Explorar precios</button><button className={priceTab === "changes" ? "tab active" : "tab"} onClick={() => { setHistoryMode(false); setPriceTab("changes"); }}>Cambios de precios</button><button className={priceTab === "explore" && historyMode ? "tab active" : "tab"} onClick={() => openProductHistory()}>Histórico por producto</button><button className={priceTab === "damasco" ? "tab active" : "tab"} onClick={() => { setHistoryMode(false); setPriceTab("damasco"); }}>Catálogos competencia</button><button className={priceTab === "competitors" ? "tab active" : "tab"} onClick={() => { setHistoryMode(false); setPriceTab("competitors"); }}>Comparador</button><button className={priceTab === "opportunities" ? "tab active" : "tab"} onClick={() => { setHistoryMode(false); setPriceTab("opportunities"); }}>Oportunidades comerciales</button></div>
          {priceTab === "explore" ? <>
          {historyMode && <div className="history-mode-banner"><div><strong>Histórico completo por producto</strong><span>Selecciona un producto para consultar todas sus capturas, incluyendo los registros donde el precio no cambió.</span></div><button onClick={openExplorePrices}>Volver al catálogo actual</button></div>}
          <section className="filters"><input aria-label="Buscar producto" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto o código SAP"/><select aria-label="Marca" value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)}><option value="">Todas las marcas</option>{brands.map((value) => <option key={value} value={value}>{value}</option>)}</select><select aria-label="Estado del producto" value={productStatus} disabled={historyMode} onChange={(event) => setProductStatus(event.target.value)}><option value="current">Vigentes en última captura</option><option value="missing">No vistos en última captura</option><option value="all">Todos los históricos</option></select><select aria-label="Variación" value={changeFilter} onChange={(event) => setChangeFilter(event.target.value)}><option value="all">Cualquier variación</option><option value="down">Rebajas</option><option value="up">Aumentos</option><option value="same">Sin cambios</option></select><select aria-label="Período" disabled><option>{historyMode ? "Todas las capturas guardadas" : "Últimos 90 días"}</option></select></section>

          <section className="content-grid">
            <article className="product-list"><div className="section-head"><h2>{historyMode ? "Productos con histórico" : productStatus === "current" ? "Catálogo actual" : productStatus === "missing" ? "No vistos en última captura" : "Catálogo histórico"}</h2><small>{productsLoading ? "Consultando catálogo…" : `Mostrando ${integer.format(products.length)} de ${integer.format(totalProducts)}`}</small></div><div className="product-scroll" ref={productListRef} onScroll={handleProductScroll}>
              {productsLoading && <div className="empty-state">Buscando productos en todo el catálogo…</div>}
              {!productsLoading && productLoadError && products.length === 0 && <div className="empty-state product-error">{productLoadError}</div>}
              {!productsLoading && !productLoadError && products.length === 0 && <div className="empty-state">No encontramos productos con ese nombre o código SAP.</div>}
              {products.map((product, index) => <button key={product.id} aria-posinset={index + 1} aria-setsize={totalProducts} className={selected?.id === product.id ? "product-row active" : "product-row"} onClick={() => setSelected(product)}><div><b>{product.name}</b><p>{product.externalId} · {product.category ?? "Sin categoría"}</p>{!product.seenInLatest && <span className="product-status-badge">No visto en última captura</span>}</div><div className="product-price"><strong>{product.currentPrice == null ? "Sin precio" : money.format(product.currentPrice)}</strong><span className={`variation ${changeClass(product.changePct)}`}>{product.changePct == null ? "—" : `${product.changePct > 0 ? "+" : ""}${product.changePct.toFixed(1)}%`}</span></div></button>)}
              {products.length > 0 && <div className="product-load-state">{loadingMoreProducts ? "Cargando más productos…" : hasMoreProducts ? "Desplázate para continuar cargando" : "Se mostraron todos los productos"}{productLoadError && products.length > 0 ? ` · ${productLoadError}` : ""}</div>}
            </div></article>
            <article className="detail-card">
              {selected ? <><div className="detail-main"><div className="detail-title"><div><h2>{selected.name}</h2><div className="meta"><span className="source-badge">D</span> Tiendas Daka · SAP {selected.externalId}</div>{!selected.seenInLatest && <div className="product-missing-notice">No fue visto en la última captura. Se muestra su último precio histórico.</div>}</div><div className="current-price"><span className="meta">{selected.seenInLatest ? "Precio actual" : "Último precio registrado"}</span><strong>{selected.currentPrice == null ? "Sin precio" : money.format(selected.currentPrice)}</strong><span className={`variation ${changeClass(selected.changePct)}`}>{selected.changePct == null ? "Sin comparación" : `${selected.changePct > 0 ? "+" : ""}${selected.changePct.toFixed(1)}% vs. captura anterior`}</span></div></div>
                {historyMode && latestCapture && <div className="price-comparison-strip"><div><span>Precio anterior</span><strong>{latestCapture.previousPrice == null ? "Sin comparación" : money.format(latestCapture.previousPrice)}</strong></div><span className="comparison-arrow">→</span><div><span>Precio actual</span><strong>{latestCapture.price == null ? "Sin precio" : money.format(latestCapture.price)}</strong></div><div className={changeClass(latestCapture.differenceUsd)}><span>Último movimiento</span><strong>{latestCapture.differenceUsd == null ? "Sin variación" : `${latestCapture.differenceUsd > 0 ? "+" : ""}${money.format(latestCapture.differenceUsd)}`}</strong><small>{latestCapture.changePct == null ? "" : `${latestCapture.changePct > 0 ? "+" : ""}${latestCapture.changePct.toFixed(1)}%`}</small></div></div>}
                {history.length ? <svg className="price-chart" viewBox="0 0 760 245" role="img" aria-label="Histórico de precio"><defs><linearGradient id="priceArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1258d9" stopOpacity=".2"/><stop offset="1" stopColor="#1258d9" stopOpacity="0"/></linearGradient></defs><line className="chart-grid" x1="45" y1="45" x2="735" y2="45"/><line className="chart-grid" x1="45" y1="115" x2="735" y2="115"/><line className="chart-grid" x1="45" y1="190" x2="735" y2="190"/><path className="chart-area" d={chart.area}/><path className="chart-line" d={chart.line}/>{(historyMode ? chart.dots : chart.dots.slice(-1)).map((dot, index) => <circle key={`${dot.scrapedAt}-${index}`} className="chart-point" cx={dot.x} cy={dot.y} r={historyMode ? "4" : "5"}><title>{`${formatDate(dot.scrapedAt)} · ${money.format(dot.price)}`}</title></circle>)}</svg> : <div className="chart-empty">El gráfico aparecerá después de la primera captura.</div>}
                <div className={historyMode ? "history-metrics-grid" : "mini-grid"}><div><span>Precio máximo histórico</span><b>{maxPrice == null ? "—" : money.format(maxPrice)}</b></div><div><span>Precio mínimo histórico</span><b>{minPrice == null ? "—" : money.format(minPrice)}</b></div><div><span>Capturas totales</span><b>{integer.format(historyTotal)} registros</b></div>{historyMode && <div><span>Cambios reales</span><b>{integer.format(historyChangeCount)}</b></div>}<div><span>Última captura</span><b>{formatDate(selected.scrapedAt)}</b></div></div></div>
                <div className="history-table"><div className="section-head"><h2>{historyMode ? "Todas las capturas del producto" : "Últimas capturas"}</h2><small>{historyMode ? `Mostrando ${integer.format(history.length)} de ${integer.format(historyTotal)} · incluye capturas sin variación` : "Fecha y hora exactas · VET"}</small></div><div className="table-scroll"><table><thead><tr><th>Fecha</th>{historyMode && <th>Precio anterior</th>}<th>Precio actual</th><th>Diferencia USD</th><th>Variación</th>{historyMode && <><th>Disponibilidad</th><th>Unidades reportadas</th></>}</tr></thead><tbody>{(historyMode ? history : history.slice(0, 10)).map((point) => <tr key={point.scrapedAt}><td>{formatDate(point.scrapedAt)}</td>{historyMode && <td>{point.previousPrice == null ? "—" : money.format(point.previousPrice)}</td>}<td>{point.price == null ? "Sin precio" : money.format(point.price)}</td><td className={changeClass(point.differenceUsd)}>{point.differenceUsd == null ? "—" : `${point.differenceUsd > 0 ? "+" : ""}${money.format(point.differenceUsd)}`}</td><td className={changeClass(point.changePct)}>{point.changePct == null ? "—" : `${point.changePct > 0 ? "+" : ""}${point.changePct.toFixed(1)}%`}</td>{historyMode && <><td>{point.inStock == null ? "No reportada" : point.inStock ? "Disponible" : "No disponible"}</td><td>{point.availableQuantity == null ? "No reportadas" : integer.format(point.availableQuantity)}</td></>}</tr>)}</tbody></table></div>{historyMode && <div className="changes-load-more">{historyHasMore ? <button onClick={() => void loadMoreHistory()} disabled={historyLoadingMore}>{historyLoadingMore ? "Cargando…" : "Cargar 100 capturas más"}</button> : <span>Se mostraron todas las capturas guardadas del producto</span>}</div>}</div></> : <div className="empty-state detail-empty">Selecciona un producto para consultar su histórico.</div>}
            </article>
          </section>
          </> : priceTab === "changes" ? <>
            {reportComparison?.source === "daka" && <div className="report-comparison-banner"><strong>Comparación del reporte de Telegram</strong><span>Se muestran exclusivamente las variaciones entre las dos capturas indicadas en la notificación.</span></div>}
            <section className="filters change-filters"><input aria-label="Buscar producto con cambios" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto o código SAP"/><select aria-label="Marca" value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)}><option value="">Todas las marcas</option>{brands.map((value) => <option key={value} value={value}>{value}</option>)}</select><select aria-label="Período de cambios" value={reportComparison?.source === "daka" ? "report" : changeDays} disabled={reportComparison?.source === "daka"} onChange={(event) => setChangeDays(event.target.value)}>{reportComparison?.source === "daka" && <option value="report">Capturas del reporte</option>}<option value="1">Hoy</option><option value="7">Últimos 7 días</option><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option><option value="all">Todo el histórico</option></select><select aria-label="Tipo de movimiento" value={changeMovement} onChange={(event) => setChangeMovement(event.target.value)}><option value="all">Aumentos y rebajas</option><option value="down">Solo rebajas</option><option value="up">Solo aumentos</option></select><select aria-label="Magnitud mínima" value={changeThreshold} onChange={(event) => setChangeThreshold(event.target.value)}><option value="0">Cualquier magnitud</option><option value="5">Cambios ≥ 5%</option><option value="10">Cambios ≥ 10%</option><option value="20">Cambios ≥ 20%</option></select><select aria-label="Estado del catálogo" value={changeStatus} disabled={reportComparison?.source === "daka"} onChange={(event) => setChangeStatus(event.target.value)}><option value="current">Productos vigentes</option><option value="missing">No vistos actualmente</option><option value="all">Todos los históricos</option></select></section>
            <section className="changes-summary"><article><span>Productos con cambios</span><strong>{changesLoading ? "…" : integer.format(changeStats.productsChanged)}</strong></article><article><span>Movimientos registrados</span><strong>{changesLoading ? "…" : integer.format(changeStats.totalChanges)}</strong></article><article className="drop"><span>Rebajas</span><strong>{changesLoading ? "…" : integer.format(changeStats.drops)}</strong></article><article className="rise"><span>Aumentos</span><strong>{changesLoading ? "…" : integer.format(changeStats.increases)}</strong></article></section>
            <section className="changes-grid">
              <article className="changes-table-card"><div className="section-head"><h2>Cambios encontrados</h2><small>{changesLoading ? "Consultando histórico…" : `Mostrando ${integer.format(changeProducts.length)} de ${integer.format(changeTotal)} productos`}</small></div>
                {changesLoading ? <div className="empty-state">Analizando las capturas del período…</div> : changeLoadError && changeProducts.length === 0 ? <div className="empty-state product-error">{changeLoadError}</div> : changeProducts.length === 0 ? <div className="empty-state">No se encontraron cambios con estos filtros.</div> : <div className="table-scroll"><table className="changes-table"><thead><tr><th>Producto</th><th>Cambios</th><th>Precio inicial → final</th><th>Diferencia</th><th>Último cambio</th></tr></thead><tbody>{changeProducts.map((product) => <tr key={product.id} className={selected?.id === product.id ? "selected-change" : ""} onClick={() => setSelected(product)}><td><b>{product.name}</b><small>{product.externalId}</small></td><td><strong>{product.changeCount}</strong><small>movimientos</small></td><td>{product.initialPrice == null || product.finalPrice == null ? "—" : `${money.format(product.initialPrice)} → ${money.format(product.finalPrice)}`}</td><td className={changeClass(product.netDifferenceUsd)}><b>{product.netDifferenceUsd == null ? "—" : `${product.netDifferenceUsd > 0 ? "+" : ""}${money.format(product.netDifferenceUsd)}`}</b><small>{product.netChangePct == null ? "" : `${product.netChangePct > 0 ? "+" : ""}${product.netChangePct.toFixed(1)}% acumulado`}</small></td><td>{formatDate(product.latestChangeAt)}</td></tr>)}</tbody></table></div>}
                {changeProducts.length > 0 && <div className="changes-load-more">{hasMoreChanges ? <button onClick={() => void loadMoreChanges()} disabled={loadingMoreChanges}>{loadingMoreChanges ? "Cargando…" : "Cargar 50 productos más"}</button> : <span>Se mostraron todos los productos con cambios</span>}</div>}
              </article>
              <article className="change-detail-card">
                {selectedChange ? <><div className="change-detail-head"><div><span className="eyebrow-dark">Detalle del período</span><h2>{selectedChange.name}</h2><p>SAP {selectedChange.externalId} · {selectedChange.changeCount} cambios {changeDays === "1" ? "durante el día" : changeDays === "all" ? "en todo el histórico" : `en ${changeDays} días`}</p><button className="history-link-button" onClick={() => openProductHistory(selectedChange)}>Ver todas las capturas del producto</button></div><div className={changeClass(selectedChange.netDifferenceUsd)}><strong>{selectedChange.netDifferenceUsd == null ? "—" : `${selectedChange.netDifferenceUsd > 0 ? "+" : ""}${money.format(selectedChange.netDifferenceUsd)}`}</strong><span>{selectedChange.netChangePct == null ? "Sin comparación" : `${selectedChange.netChangePct > 0 ? "+" : ""}${selectedChange.netChangePct.toFixed(1)}% acumulado`}</span></div></div>
                  {history.length > 0 && <><div className="chart-caption">Evolución de las capturas guardadas · coloca el cursor sobre un punto para ver su fecha y precio</div><svg className="price-chart change-chart" viewBox="0 0 760 245" role="img" aria-label="Evolución histórica del precio"><line className="chart-grid" x1="45" y1="45" x2="735" y2="45"/><line className="chart-grid" x1="45" y1="115" x2="735" y2="115"/><line className="chart-grid" x1="45" y1="190" x2="735" y2="190"/><path className="chart-line" d={chart.line}/>{chart.dots.map((dot, index) => <circle key={`${dot.scrapedAt}-${index}`} className="chart-point" cx={dot.x} cy={dot.y} r="4"><title>{`${formatDate(dot.scrapedAt)} · ${money.format(dot.price)}`}</title></circle>)}</svg><div className="mini-grid change-history-summary"><div><span>Precio máximo</span><b>{maxPrice == null ? "—" : money.format(maxPrice)}</b></div><div><span>Precio mínimo</span><b>{minPrice == null ? "—" : money.format(minPrice)}</b></div><div><span>Capturas guardadas</span><b>{integer.format(historyTotal)}</b></div><div><span>Cambios del período</span><b>{integer.format(selectedChange.changeCount)}</b></div></div></>}
                  <div className="history-table"><div className="section-head"><div><h2>Historial de cambios de precio</h2><small className="section-explanation">Solo se muestran las capturas donde el precio cambió.</small></div><small>{movementsLoading ? "Consultando…" : `Mostrando ${integer.format(movements.length)} de ${integer.format(movementTotal)}`}</small></div>{movementsLoading ? <div className="empty-state">Cargando movimientos…</div> : <><div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Precio anterior</th><th>Precio nuevo</th><th>Diferencia USD</th><th>Variación</th></tr></thead><tbody>{movements.map((point) => <tr key={point.scrapedAt}><td>{formatDate(point.scrapedAt)}</td><td>{point.previousPrice == null ? "—" : money.format(point.previousPrice)}</td><td>{point.price == null ? "Sin precio" : money.format(point.price)}</td><td className={changeClass(point.differenceUsd)}>{point.differenceUsd == null ? "—" : `${point.differenceUsd > 0 ? "+" : ""}${money.format(point.differenceUsd)}`}</td><td className={changeClass(point.changePct)}>{point.changePct == null ? "—" : `${point.changePct > 0 ? "+" : ""}${point.changePct.toFixed(1)}%`}</td></tr>)}</tbody></table></div><div className="changes-load-more">{hasMoreMovements ? <button onClick={() => void loadMoreMovements()} disabled={loadingMoreMovements}>{loadingMoreMovements ? "Cargando…" : "Cargar 50 movimientos más"}</button> : <span>{movementTotal ? "Se mostraron todos los cambios reales del período" : "No existen cambios con estos filtros"}</span>}</div></>}</div></> : <div className="empty-state detail-empty">Selecciona un producto para visualizar todos sus movimientos.</div>}
              </article>
            </section>
          </> : priceTab === "damasco" ? <DamascoCatalog reportComparison={reportComparison}/> : priceTab === "competitors" ? <CompetitorComparison canAdmin={currentRole === "admin"}/> : <CommercialOpportunities canAdmin={currentRole === "admin"}/>}
          <section className="roadmap"><div><strong>Benchmarking competitivo habilitado con Damasco, Multimax, IVOO y Venelectronics</strong><span>La arquitectura mantiene cada fuente separada y permite sumar nuevas tiendas sin perder trazabilidad.</span></div><div className="stages"><span className="stage">Fase 1 · DAKA</span><span>→</span><span className="stage">Fase 2 · Damasco</span><span>→</span><span className="stage">Fase 3 · Multimax</span><span>→</span><span className="stage">Fase 4 · IVOO</span><span>→</span><span className="stage">Fase 5 · Venelectronics</span></div></section>
        </main>
      ) : <TechnicalMonitoring jobs={jobs} sources={monitoringSources} latestRequest={latestRequest} running={running} reportSending={reportSending} canAdmin={currentRole === "admin"} onTriggerDaka={triggerScrape} onSendTelegramReport={sendTelegramReport}/>}
    </div>
  );
}
