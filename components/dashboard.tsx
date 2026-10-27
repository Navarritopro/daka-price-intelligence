"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type UIEvent } from "react";
import type { DashboardData, JobsResponse, JobSummary, MonitoringSourceSummary, ProductSummary } from "@/lib/types";
import CompetitorComparison from "@/components/competitor-comparison";
import CommercialOpportunities from "@/components/commercial-opportunities";
import CatalogChanges from "@/components/catalog-changes";
import PriceAdjustmentControl from "@/components/price-adjustment-control";
import VenelectronicsPriceAdjustment from "@/components/venelectronics-price-adjustment";
import DamascoCatalog from "@/components/damasco-catalog";
import TechnicalMonitoring from "@/components/technical-monitoring";
import SessionControls from "@/components/session-controls";
import OnboardingCenter, { type OnboardingNavigationTarget } from "@/components/onboarding-center";
import DakaProductUniverse from "@/components/daka-product-universe";
import ExecutiveSummary from "@/components/executive-summary";
import FilterFeedback, { type ActiveFilter } from "@/components/filter-feedback";
import { readApiJson } from "@/lib/api-client";
import { describeCatalogFilters, describePriceChangeFilters } from "@/lib/catalog-filter-state";
import { allowedQueryValue, mergeQueryString, queryText } from "@/lib/navigation-state";
import { nextTabIndex } from "@/lib/accessible-tabs";

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
type View = "prices" | "universe" | "operations" | "executive";
type PriceTab = "explore" | "changes" | "damasco" | "catalogChanges" | "competitors" | "opportunities";
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

function moveTabFocus(event: ReactKeyboardEvent<HTMLButtonElement>, currentIndex: number) {
  const tabs = Array.from(event.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
  const nextIndex = nextTabIndex(event.key, currentIndex, tabs.length);
  if (nextIndex == null) return;
  event.preventDefault();
  tabs[nextIndex]?.focus();
  tabs[nextIndex]?.click();
}

function movementLabel(value: number | null) {
  if (value == null || value === 0) return "Sin variación";
  return value < 0 ? "Rebaja" : "Aumento";
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
  const [executiveVisited, setExecutiveVisited] = useState(false);
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
  const [productRefreshToken, setProductRefreshToken] = useState(0);
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
  const [changeRefreshToken, setChangeRefreshToken] = useState(0);
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
  const [navigationReady, setNavigationReady] = useState(false);
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
      const [summaryData, jobsData, requestData]: [DashboardData, JobsResponse, ScrapeRequest | null] = await Promise.all([
        readApiJson<DashboardData>(summaryResponse, "No fue posible cargar el resumen"),
        readApiJson<JobsResponse>(jobsResponse, "No fue posible cargar las ejecuciones"),
        readApiJson<ScrapeRequest | null>(requestResponse, "No fue posible consultar la solicitud actual")
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

  const restoreNavigation = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const restoredView = allowedQueryValue(params, "view", ["prices", "universe", "operations", "executive"] as const, "prices");
    const restoredTab = allowedQueryValue(params, "priceTab", ["explore", "changes", "damasco", "catalogChanges", "competitors", "opportunities"] as const, "explore");
    const restoredHistory = params.get("history") === "product";
    setView(restoredView);
    if (restoredView === "executive") setExecutiveVisited(true);
    setPriceTab(restoredTab);
    setHistoryMode(restoredHistory && restoredTab === "explore");
    setSearch(queryText(params, "search"));
    setDebouncedSearch(queryText(params, "search"));
    setBrandFilter(queryText(params, "brand", 80));
    setProductStatus(restoredHistory ? "all" : allowedQueryValue(params, "productStatus", ["current", "missing", "all"] as const, "current"));
    setChangeFilter(allowedQueryValue(params, "variation", ["all", "down", "up", "same"] as const, "all"));
    setChangeDays(allowedQueryValue(params, "days", ["1", "7", "30", "90", "all"] as const, "30"));
    setChangeMovement(allowedQueryValue(params, "movement", ["all", "down", "up"] as const, "all"));
    setChangeThreshold(allowedQueryValue(params, "threshold", ["0", "5", "10", "20"] as const, "0"));
    setChangeStatus(allowedQueryValue(params, "changeStatus", ["current", "missing", "all"] as const, "current"));
    const source = params.get("source") ?? "";
    const currentJob = params.get("currentJob") ?? "";
    const previousJob = params.get("previousJob") ?? "";
    if (currentJob && previousJob && ["daka", "damasco", "multimax", "ivoo", "venelectronics", "soytechno"].includes(source)) {
      setReportComparison({ source, currentJob, previousJob });
      setPriceTab(source === "daka" ? "changes" : "damasco");
    } else setReportComparison(null);
    setNavigationReady(true);
  }, []);

  useEffect(() => {
    restoreNavigation();
    window.addEventListener("popstate", restoreNavigation);
    return () => window.removeEventListener("popstate", restoreNavigation);
  }, [restoreNavigation]);

  useEffect(() => {
    if (!navigationReady) return;
    const searchString = mergeQueryString(window.location.search, {
      view: view === "prices" ? null : view,
      priceTab: view === "prices" && priceTab !== "explore" ? priceTab : null,
      history: view === "prices" && priceTab === "explore" && historyMode ? "product" : null,
      search: view === "prices" && (priceTab === "explore" || priceTab === "changes") ? search.trim() : null,
      brand: view === "prices" && (priceTab === "explore" || priceTab === "changes") ? brandFilter : null,
      productStatus: view === "prices" && priceTab === "explore" && !historyMode && productStatus !== "current" ? productStatus : null,
      variation: view === "prices" && priceTab === "explore" && changeFilter !== "all" ? changeFilter : null,
      days: view === "prices" && priceTab === "changes" && changeDays !== "30" ? changeDays : null,
      movement: view === "prices" && priceTab === "changes" && changeMovement !== "all" ? changeMovement : null,
      threshold: view === "prices" && priceTab === "changes" && changeThreshold !== "0" ? changeThreshold : null,
      changeStatus: view === "prices" && priceTab === "changes" && changeStatus !== "current" ? changeStatus : null,
      product: view === "prices" && (priceTab === "explore" || priceTab === "changes") && selected ? selected.id : null
    });
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${searchString}${window.location.hash}`);
  }, [brandFilter, changeDays, changeFilter, changeMovement, changeStatus, changeThreshold, historyMode, navigationReady, priceTab, productStatus, search, selected, view]);

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
      .then((response) => readApiJson<ProductPage>(response, "No fue posible cargar el catálogo"))
      .then((page: ProductPage) => {
        if (version !== productQueryVersion.current) return;
        setProducts(page.items);
        setTotalProducts(page.total);
        setHasMoreProducts(page.hasMore);
        setBrands(page.brands ?? []);
        const requestedProductId = Number(new URLSearchParams(window.location.search).get("product"));
        setSelected(page.items.find((item) => item.id === requestedProductId) ?? page.items[0] ?? null);
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
  }, [brandFilter, debouncedSearch, changeFilter, priceTab, productRefreshToken, productStatus, resetProductScroll]);

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
    params.set("includeMetadata", "0");

    try {
      const response = await fetch(`/api/products?${params.toString()}`, { cache: "no-store" });
      const page = await readApiJson<ProductPage>(response, "No fue posible cargar el siguiente grupo de productos");
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
      .then((response) => readApiJson<ChangePage>(response, "No fue posible consultar los cambios de precios"))
      .then((page: ChangePage) => {
        if (version !== changeQueryVersion.current) return;
        setChangeProducts(page.items);
        setChangeTotal(page.total);
        setHasMoreChanges(page.hasMore);
        setChangeStats(page.stats);
        setBrands(page.brands ?? []);
        const requestedProductId = Number(new URLSearchParams(window.location.search).get("product"));
        setSelected(page.items.find((item) => item.id === requestedProductId) ?? page.items[0] ?? null);
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
  }, [brandFilter, changeDays, changeMovement, changeRefreshToken, changeStatus, changeThreshold, debouncedSearch, priceTab, reportComparison]);

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
    params.set("includeMetadata", "0");
    if (reportComparison?.source === "daka") {
      params.set("currentJob", reportComparison.currentJob);
      params.set("previousJob", reportComparison.previousJob);
    }
    try {
      const response = await fetch(`/api/price-changes?${params.toString()}`, { cache: "no-store" });
      const page = await readApiJson<ChangePage>(response, "No fue posible cargar el siguiente grupo de cambios");
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
        const [updatedJobs, updatedRequest]: [JobsResponse, ScrapeRequest | null] = await Promise.all([
          readApiJson<JobsResponse>(jobsResponse, "No fue posible actualizar las ejecuciones"),
          readApiJson<ScrapeRequest | null>(requestResponse, "No fue posible actualizar la solicitud")
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
      .then((response) => readApiJson<CapturePage>(response, "No fue posible cargar el histórico"))
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
      const page = await readApiJson<CapturePage>(response, "No fue posible cargar el siguiente grupo de capturas");
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
      .then((response) => readApiJson<MovementPage>(response, "No fue posible cargar los movimientos"))
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
      const page = await readApiJson<MovementPage>(response, "No fue posible cargar el siguiente grupo de movimientos");
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

  function pushNavigation(changes: Record<string, string | null>) {
    const searchString = mergeQueryString(window.location.search, changes);
    window.history.pushState({ ...(window.history.state ?? {}), dakaNavigation: true }, "", `${window.location.pathname}${searchString}${window.location.hash}`);
  }

  function returnToPreviousView() {
    if (window.history.state?.dakaNavigation) {
      window.history.back();
      return;
    }
    const searchString = mergeQueryString(window.location.search, {
      view: null, priceTab: null, history: null, product: null,
      search: null, brand: null, productStatus: null, variation: null,
      days: null, movement: null, threshold: null, changeStatus: null
    });
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${searchString}${window.location.hash}`);
    setView("prices");
    setPriceTab("explore");
    setHistoryMode(false);
    setSearch("");
    setDebouncedSearch("");
    setBrandFilter("");
    setProductStatus("current");
    setChangeFilter("all");
    setChangeDays("30");
    setChangeMovement("all");
    setChangeThreshold("0");
    setChangeStatus("current");
    setSelected(null);
  }

  function navigateToView(nextView: View) {
    pushNavigation({ view: nextView === "prices" ? null : nextView });
    if (nextView === "executive") setExecutiveVisited(true);
    setView(nextView);
  }

  function navigateToPriceTab(nextTab: PriceTab) {
    pushNavigation({ view: null, priceTab: nextTab === "explore" ? null : nextTab, history: null, product: null });
    setView("prices");
    setHistoryMode(false);
    setPriceTab(nextTab);
  }

  function openExplorePrices() {
    pushNavigation({ view: null, priceTab: null, history: null, product: null });
    resetProductScroll();
    setHistoryMode(false);
    setPriceTab("explore");
    setProductStatus("current");
  }

  function openProductHistory(product?: ProductSummary) {
    pushNavigation({ view: null, priceTab: null, history: "product", product: product ? String(product.id) : null });
    resetProductScroll();
    setHistoryMode(true);
    setPriceTab("explore");
    setProductStatus("all");
    setChangeFilter("all");
    if (product) setSearch(product.externalId);
  }

  function clearCatalogFilters() {
    setSearch("");
    setDebouncedSearch("");
    setBrandFilter("");
    setProductStatus(historyMode ? "all" : "current");
    setChangeFilter("all");
  }

  function clearPriceChangeFilters() {
    setSearch("");
    setDebouncedSearch("");
    setBrandFilter("");
    setChangeMovement("all");
    setChangeThreshold("0");
    if (reportComparison?.source !== "daka") {
      setChangeDays("30");
      setChangeStatus("current");
    }
  }

  const chart = useMemo(() => chartPath(history), [history]);

  async function triggerScrape() {
    setRunning(true);
    try {
      const response = await fetch("/api/scrape", { method: "POST" });
      const payload = await readApiJson<{ error?: string; request: { id: string | number; requested_at: string } }>(response, "No fue posible iniciar la ejecución");
      if (!response.ok) throw new Error(payload.error ?? "No fue posible iniciar la ejecución");
      setLatestRequest({
        id: String(payload.request.id),
        status: "queued",
        requestedAt: payload.request.requested_at,
        claimedAt: null,
        finishedAt: null,
        errorMessage: null
      });
      navigateToView("operations");
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
      const payload = await readApiJson<{ error?: string }>(response, "No fue posible solicitar el reporte");
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
  const catalogFilterDescriptors = describeCatalogFilters({
    search,
    brand: brandFilter,
    status: productStatus,
    change: changeFilter
  }, { historyMode });
  const catalogActiveFilters: ActiveFilter[] = catalogFilterDescriptors.map((filter) => ({
    ...filter,
    onRemove: () => {
      if (filter.key === "search") { setSearch(""); setDebouncedSearch(""); }
      if (filter.key === "brand") setBrandFilter("");
      if (filter.key === "status") setProductStatus("current");
      if (filter.key === "change") setChangeFilter("all");
    }
  }));
  const priceChangeFilterDescriptors = describePriceChangeFilters({
    search,
    brand: brandFilter,
    days: changeDays,
    movement: changeMovement,
    threshold: changeThreshold,
    status: changeStatus
  }, { reportMode: reportComparison?.source === "daka" });
  const priceChangeActiveFilters: ActiveFilter[] = priceChangeFilterDescriptors.map((filter) => ({
    ...filter,
    onRemove: () => {
      if (filter.key === "search") { setSearch(""); setDebouncedSearch(""); }
      if (filter.key === "brand") setBrandFilter("");
      if (filter.key === "days") setChangeDays("30");
      if (filter.key === "movement") setChangeMovement("all");
      if (filter.key === "threshold") setChangeThreshold("0");
      if (filter.key === "status") setChangeStatus("current");
    }
  }));

  function navigateFromOnboarding(target: OnboardingNavigationTarget) {
    setHistoryMode(false);
    if (target === "monitoring") {
      navigateToView("operations");
      return;
    }
    if (target === "universe") {
      navigateToView("universe");
      return;
    }
    if (target === "explore") {
      navigateToPriceTab("explore");
      setProductStatus("current");
      resetProductScroll();
    } else if (target === "competitors") {
      navigateToPriceTab("damasco");
    } else if (target === "catalogChanges") {
      navigateToPriceTab("catalogChanges");
    } else if (target === "comparison") {
      navigateToPriceTab("competitors");
    } else {
      navigateToPriceTab("opportunities");
    }
  }

  return (
    <div className="app-wrap">
      {notice && <div className="notice" role="status">{notice}</div>}
      <header className="app-header">
        <div className="brand">DAKA <span>PRICE LAB</span></div>
        <nav className="module-nav" aria-label="Módulos principales" data-tour="module-nav">
          <button className={view === "executive" ? "module-button active" : "module-button"} onClick={() => navigateToView("executive")}>Resumen ejecutivo</button>
          <button className={view === "prices" ? "module-button active" : "module-button"} onClick={() => navigateToView("prices")}>Inteligencia de precios</button>
          <button className={view === "universe" ? "module-button active" : "module-button"} onClick={() => navigateToView("universe")}>Universo de Productos Daka</button>
          <button className={view === "operations" ? "module-button active" : "module-button"} onClick={() => navigateToView("operations")}>Monitoreo técnico</button>
        </nav>
        <div className="header-actions">
          <span className="next-run">Competidores · 09:07–09:33 AM VET</span>
          {currentRole === "admin" && <button className="primary-button" onClick={triggerScrape} disabled={executionBusy}>{running ? "Iniciando…" : executionBusy ? "Ejecución pendiente" : "Actualizar datos ahora"}</button>}
          <OnboardingCenter role={currentRole} onNavigate={navigateFromOnboarding}/>
          <SessionControls onRole={setCurrentRole}/>
        </div>
      </header>
      <VenelectronicsPriceAdjustment/>
      <PriceAdjustmentControl source="daka"/>

      {error && <div className="error-banner"><strong>Conexión pendiente</strong><span>{error}</span><button onClick={() => void load()}>Reintentar</button></div>}
      {(view !== "prices" || priceTab !== "explore" || historyMode) && <div className="context-back-row"><button type="button" onClick={returnToPreviousView}>← Volver a la vista anterior</button></div>}

      {(view === "executive" || executiveVisited) && <div hidden={view !== "executive"}><ExecutiveSummary onOpenMonitoring={() => navigateToView("operations")} onOpenComparison={() => navigateToPriceTab("competitors")} onOpenCatalog={() => navigateToPriceTab("damasco")}/></div>}
      {view === "executive" ? null : view === "prices" ? (
        <main className="price-intelligence">
          <section className="hero-grid" data-tour="dashboard-summary">
            <article className="intro-card"><div className="eyebrow">Inteligencia de precios · Fases 1 y 2</div><h1>El mercado y el histórico de DAKA, en una sola vista.</h1><p>Seguimiento diario en USD, variaciones históricas y comparación competitiva con homologación auditable.</p></article>
            <div className="hero-stats">
              <article className="stat-card"><span>Catálogo actual</span><strong>{loading ? "…" : integer.format(summary?.productsMonitored ?? 0)}</strong><em>{integer.format(summary?.productsHistorical ?? 0)} históricos · {integer.format(summary?.productsNotSeen ?? 0)} no vistos</em></article>
              <article className="stat-card accent"><span>Oportunidades de rebaja</span><strong>{loading ? "…" : integer.format(summary?.priceDropsToday ?? 0)}</strong><em>Detectadas hoy</em></article>
              <article className="stat-card"><span>Precio promedio</span><strong>{loading ? "…" : money.format(summary?.averagePrice ?? 0)}</strong><em>{summary?.changesToday ?? 0} cambios ≥ ±5%</em></article>
              <article className="stat-card"><span>Última ejecución DAKA</span><strong>{jobStatusLabel(summary?.lastJobStatus)}</strong><em>{formatDuration(summary?.lastJobDurationSeconds)} · {formatDate(summary?.lastJobAt)}</em><small>Última captura exitosa: {formatDate(summary?.lastScrapeAt)}</small></article>
            </div>
          </section>

          <div className="tabs" role="tablist" aria-label="Secciones de inteligencia de precios" data-tour="intelligence-tabs"><button type="button" role="tab" aria-selected={priceTab === "explore" && !historyMode} tabIndex={priceTab === "explore" && !historyMode ? 0 : -1} className={priceTab === "explore" && !historyMode ? "tab active" : "tab"} onKeyDown={(event) => moveTabFocus(event, 0)} onClick={openExplorePrices}>Explorar precios</button><button type="button" role="tab" aria-selected={priceTab === "changes"} tabIndex={priceTab === "changes" ? 0 : -1} className={priceTab === "changes" ? "tab active" : "tab"} onKeyDown={(event) => moveTabFocus(event, 1)} onClick={() => navigateToPriceTab("changes")}>Cambios de precios</button><button type="button" role="tab" aria-selected={priceTab === "explore" && historyMode} tabIndex={priceTab === "explore" && historyMode ? 0 : -1} className={priceTab === "explore" && historyMode ? "tab active" : "tab"} onKeyDown={(event) => moveTabFocus(event, 2)} onClick={() => openProductHistory()}>Histórico por producto</button><button type="button" role="tab" aria-selected={priceTab === "damasco"} tabIndex={priceTab === "damasco" ? 0 : -1} className={priceTab === "damasco" ? "tab active" : "tab"} onKeyDown={(event) => moveTabFocus(event, 3)} onClick={() => navigateToPriceTab("damasco")}>Catálogos competencia</button><button type="button" role="tab" aria-selected={priceTab === "catalogChanges"} tabIndex={priceTab === "catalogChanges" ? 0 : -1} className={priceTab === "catalogChanges" ? "tab active" : "tab"} onKeyDown={(event) => moveTabFocus(event, 4)} onClick={() => navigateToPriceTab("catalogChanges")}>Cambios de catálogo</button><button type="button" role="tab" aria-selected={priceTab === "competitors"} tabIndex={priceTab === "competitors" ? 0 : -1} className={priceTab === "competitors" ? "tab active" : "tab"} onKeyDown={(event) => moveTabFocus(event, 5)} onClick={() => navigateToPriceTab("competitors")}>Comparador</button><button type="button" role="tab" aria-selected={priceTab === "opportunities"} tabIndex={priceTab === "opportunities" ? 0 : -1} className={priceTab === "opportunities" ? "tab active" : "tab"} onKeyDown={(event) => moveTabFocus(event, 6)} onClick={() => navigateToPriceTab("opportunities")}>Oportunidades comerciales</button></div>
          {priceTab === "explore" ? <>
          {priceTab === "explore" && !historyMode && <PriceAdjustmentControl source="daka" controls canAdmin={currentRole === "admin"}/>}
          {historyMode && <div className="history-mode-banner"><div><strong>Histórico completo por producto</strong><span>Selecciona un producto para consultar todas sus capturas, incluyendo los registros donde el precio no cambió.</span></div><button onClick={openExplorePrices}>Volver al catálogo actual</button></div>}
          <section className="filters" aria-label="Filtros del catálogo DAKA" data-tour="catalog-filters"><label className="accessible-filter-field"><span>Buscar producto</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre o código SAP"/></label><label className="accessible-filter-field"><span>Marca</span><select value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)}><option value="">Todas las marcas</option>{brands.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="accessible-filter-field"><span>Estado del producto</span><select value={productStatus} disabled={historyMode} onChange={(event) => setProductStatus(event.target.value)}><option value="current">Vigentes en última captura</option><option value="missing">No vistos en última captura</option><option value="all">Todos los históricos</option></select></label><label className="accessible-filter-field"><span>Variación</span><select value={changeFilter} onChange={(event) => setChangeFilter(event.target.value)}><option value="all">Cualquier variación</option><option value="down">Rebajas</option><option value="up">Aumentos</option><option value="same">Sin cambios</option></select></label><label className="accessible-filter-field"><span>Período</span><select disabled><option>{historyMode ? "Todas las capturas guardadas" : "Últimos 90 días"}</option></select></label></section>
          <FilterFeedback filters={catalogActiveFilters} visible={products.length} total={totalProducts} loading={productsLoading} onClear={clearCatalogFilters}/>

          <section className="content-grid">
            <article className="product-list" data-tour="daka-catalog-list"><div className="section-head"><h2>{historyMode ? "Productos con histórico" : productStatus === "current" ? "Catálogo actual" : productStatus === "missing" ? "No vistos en última captura" : "Catálogo histórico"}</h2><small>{productsLoading ? "Consultando catálogo…" : `Mostrando ${integer.format(products.length)} de ${integer.format(totalProducts)}`}</small></div><div className="product-scroll" ref={productListRef} onScroll={handleProductScroll}>
              {productsLoading && <div className="empty-state">Buscando productos en todo el catálogo…</div>}
              {!productsLoading && productLoadError && products.length === 0 && <div className="empty-state product-error comparison-empty" role="alert"><strong>Catálogo temporalmente no disponible</strong><span>{productLoadError}</span><button type="button" className="secondary-button" onClick={() => setProductRefreshToken((current) => current + 1)}>Reintentar</button></div>}
              {!productsLoading && !productLoadError && products.length === 0 && <div className="empty-state comparison-empty"><strong>No encontramos productos con estos criterios.</strong><span>{catalogActiveFilters.length ? "Elimina uno o varios filtros para ampliar los resultados." : "El catálogo todavía no contiene productos para esta vista."}</span>{catalogActiveFilters.length > 0 && <button type="button" className="secondary-button" onClick={clearCatalogFilters}>Limpiar filtros</button>}</div>}
              {products.map((product, index) => <button key={product.id} aria-posinset={index + 1} aria-setsize={totalProducts} aria-pressed={selected?.id === product.id} className={selected?.id === product.id ? "product-row active" : "product-row"} onClick={() => setSelected(product)}><div><b>{product.name}</b><p>{product.externalId} · {product.category ?? "Sin categoría"}</p>{!product.seenInLatest && <span className="product-status-badge">No visto en última captura</span>}</div><div className="product-price"><strong>{product.currentPrice == null ? "Sin precio" : money.format(product.currentPrice)}</strong><span className={`variation ${changeClass(product.changePct)}`}>{product.changePct == null ? "—" : `${product.changePct > 0 ? "+" : ""}${product.changePct.toFixed(1)}%`}</span></div></button>)}
              {products.length > 0 && <div className="product-load-state">{loadingMoreProducts ? "Cargando más productos…" : hasMoreProducts ? "Desplázate para continuar cargando" : "Se mostraron todos los productos"}{productLoadError && products.length > 0 ? ` · ${productLoadError}` : ""}</div>}
            </div></article>
            <article className="detail-card" data-tour="daka-product-detail">
              {selected ? <><div className="detail-main"><div className="detail-title"><div><h2>{selected.name}</h2><div className="meta"><span className="source-badge">D</span> Tiendas Daka · SAP {selected.externalId}</div>{!selected.seenInLatest && <div className="product-missing-notice">No fue visto en la última captura. Se muestra su último precio histórico.</div>}</div><div className="current-price"><span className="meta">{selected.adjustmentPercentage ? "Precio web con descuento" : selected.seenInLatest ? "Precio actual" : "Último precio registrado"}</span><strong>{selected.currentPrice == null ? "Sin precio" : money.format(selected.currentPrice)}</strong>{Boolean(selected.adjustmentPercentage) && <small>Web capturado: {selected.capturedPrice == null ? "Sin precio" : money.format(selected.capturedPrice)} · descuento {Math.abs(selected.adjustmentPercentage ?? 0)}%</small>}<span className={`variation ${changeClass(selected.changePct)}`}>{selected.changePct == null ? "Sin comparación" : `${selected.changePct > 0 ? "+" : ""}${selected.changePct.toFixed(1)}% vs. captura anterior`}</span></div></div>
                {historyMode && latestCapture && <div className="price-comparison-strip"><div><span>Precio anterior</span><strong>{latestCapture.previousPrice == null ? "Sin comparación" : money.format(latestCapture.previousPrice)}</strong></div><span className="comparison-arrow">→</span><div><span>Precio actual</span><strong>{latestCapture.price == null ? "Sin precio" : money.format(latestCapture.price)}</strong></div><div className={changeClass(latestCapture.differenceUsd)}><span>Último movimiento</span><strong>{latestCapture.differenceUsd == null ? "Sin variación" : `${latestCapture.differenceUsd > 0 ? "+" : ""}${money.format(latestCapture.differenceUsd)}`}</strong><small>{latestCapture.changePct == null ? "" : `${latestCapture.changePct > 0 ? "+" : ""}${latestCapture.changePct.toFixed(1)}%`}</small></div></div>}
                {history.length ? <svg className="price-chart" viewBox="0 0 760 245" role="img" aria-label="Histórico de precio"><defs><linearGradient id="priceArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1258d9" stopOpacity=".2"/><stop offset="1" stopColor="#1258d9" stopOpacity="0"/></linearGradient></defs><line className="chart-grid" x1="45" y1="45" x2="735" y2="45"/><line className="chart-grid" x1="45" y1="115" x2="735" y2="115"/><line className="chart-grid" x1="45" y1="190" x2="735" y2="190"/><path className="chart-area" d={chart.area}/><path className="chart-line" d={chart.line}/>{(historyMode ? chart.dots : chart.dots.slice(-1)).map((dot, index) => <circle key={`${dot.scrapedAt}-${index}`} className="chart-point" cx={dot.x} cy={dot.y} r={historyMode ? "4" : "5"}><title>{`${formatDate(dot.scrapedAt)} · ${money.format(dot.price)}`}</title></circle>)}</svg> : <div className="chart-empty">El gráfico aparecerá después de la primera captura.</div>}
                <div className={historyMode ? "history-metrics-grid" : "mini-grid"}><div><span>Precio máximo histórico</span><b>{maxPrice == null ? "—" : money.format(maxPrice)}</b></div><div><span>Precio mínimo histórico</span><b>{minPrice == null ? "—" : money.format(minPrice)}</b></div><div><span>Capturas totales</span><b>{integer.format(historyTotal)} registros</b></div>{historyMode && <div><span>Cambios reales</span><b>{integer.format(historyChangeCount)}</b></div>}<div><span>Última captura</span><b>{formatDate(selected.scrapedAt)}</b></div></div></div>
                <div className="history-table"><div className="section-head"><h2>{historyMode ? "Todas las capturas del producto" : "Últimas capturas"}</h2><small>{historyMode ? `Mostrando ${integer.format(history.length)} de ${integer.format(historyTotal)} · incluye capturas sin variación` : "Fecha y hora exactas · VET"}</small></div><div className="table-scroll" tabIndex={0} aria-label="Histórico de capturas DAKA; desplázate horizontalmente si es necesario"><table><caption className="sr-only">Histórico de precios y disponibilidad del producto DAKA seleccionado</caption><thead><tr><th scope="col">Fecha</th>{historyMode && <th scope="col">Precio anterior</th>}<th scope="col">Precio actual</th><th scope="col">Diferencia USD</th><th scope="col">Variación</th>{historyMode && <><th scope="col">Disponibilidad</th><th scope="col">Unidades reportadas</th></>}</tr></thead><tbody>{(historyMode ? history : history.slice(0, 10)).map((point) => <tr key={point.scrapedAt}><td>{formatDate(point.scrapedAt)}</td>{historyMode && <td>{point.previousPrice == null ? "—" : money.format(point.previousPrice)}</td>}<td>{point.price == null ? "Sin precio" : money.format(point.price)}</td><td className={changeClass(point.differenceUsd)}><span className="sr-only">{movementLabel(point.differenceUsd)}: </span>{point.differenceUsd == null ? "—" : `${point.differenceUsd > 0 ? "+" : ""}${money.format(point.differenceUsd)}`}</td><td className={changeClass(point.changePct)}>{point.changePct == null ? "—" : `${point.changePct > 0 ? "+" : ""}${point.changePct.toFixed(1)}%`}</td>{historyMode && <><td>{point.inStock == null ? "No reportada" : point.inStock ? "Disponible" : "No disponible"}</td><td>{point.availableQuantity == null ? "No reportadas" : integer.format(point.availableQuantity)}</td></>}</tr>)}</tbody></table></div>{historyMode && <div className="changes-load-more">{historyHasMore ? <button onClick={() => void loadMoreHistory()} disabled={historyLoadingMore}>{historyLoadingMore ? "Cargando…" : "Cargar 100 capturas más"}</button> : <span>Se mostraron todas las capturas guardadas del producto</span>}</div>}</div></> : <div className="empty-state detail-empty">Selecciona un producto para consultar su histórico.</div>}
            </article>
          </section>
          </> : priceTab === "changes" ? <>
            {reportComparison?.source === "daka" && <div className="report-comparison-banner"><strong>Comparación del reporte de Telegram</strong><span>Se muestran exclusivamente las variaciones entre las dos capturas indicadas en la notificación.</span></div>}
            <section className="filters change-filters" aria-label="Filtros de cambios de precios DAKA"><label className="accessible-filter-field"><span>Buscar producto</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre o código SAP"/></label><label className="accessible-filter-field"><span>Marca</span><select value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)}><option value="">Todas las marcas</option>{brands.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="accessible-filter-field"><span>Período</span><select value={reportComparison?.source === "daka" ? "report" : changeDays} disabled={reportComparison?.source === "daka"} onChange={(event) => setChangeDays(event.target.value)}>{reportComparison?.source === "daka" && <option value="report">Capturas del reporte</option>}<option value="1">Hoy</option><option value="7">Últimos 7 días</option><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option><option value="all">Todo el histórico</option></select></label><label className="accessible-filter-field"><span>Tipo de movimiento</span><select value={changeMovement} onChange={(event) => setChangeMovement(event.target.value)}><option value="all">Aumentos y rebajas</option><option value="down">Solo rebajas</option><option value="up">Solo aumentos</option></select></label><label className="accessible-filter-field"><span>Magnitud mínima</span><select value={changeThreshold} onChange={(event) => setChangeThreshold(event.target.value)}><option value="0">Cualquier magnitud</option><option value="5">Cambios ≥ 5%</option><option value="10">Cambios ≥ 10%</option><option value="20">Cambios ≥ 20%</option></select></label><label className="accessible-filter-field"><span>Estado del catálogo</span><select value={changeStatus} disabled={reportComparison?.source === "daka"} onChange={(event) => setChangeStatus(event.target.value)}><option value="current">Productos vigentes</option><option value="missing">No vistos actualmente</option><option value="all">Todos los históricos</option></select></label></section>
            <FilterFeedback filters={priceChangeActiveFilters} visible={changeProducts.length} total={changeTotal} loading={changesLoading} onClear={clearPriceChangeFilters}/>
            <section className="changes-summary"><article><span>Productos con cambios</span><strong>{changesLoading ? "…" : integer.format(changeStats.productsChanged)}</strong></article><article><span>Movimientos registrados</span><strong>{changesLoading ? "…" : integer.format(changeStats.totalChanges)}</strong></article><article className="drop"><span>Rebajas</span><strong>{changesLoading ? "…" : integer.format(changeStats.drops)}</strong></article><article className="rise"><span>Aumentos</span><strong>{changesLoading ? "…" : integer.format(changeStats.increases)}</strong></article></section>
            <section className="changes-grid">
              <article className="changes-table-card"><div className="section-head"><h2>Cambios encontrados</h2><small>{changesLoading ? "Consultando histórico…" : `Mostrando ${integer.format(changeProducts.length)} de ${integer.format(changeTotal)} productos`}</small></div>
                {changesLoading ? <div className="empty-state">Analizando las capturas del período…</div> : changeLoadError && changeProducts.length === 0 ? <div className="empty-state product-error comparison-empty" role="alert"><strong>Cambios temporalmente no disponibles</strong><span>{changeLoadError}</span><button type="button" className="secondary-button" onClick={() => setChangeRefreshToken((current) => current + 1)}>Reintentar</button></div> : changeProducts.length === 0 ? <div className="empty-state comparison-empty"><strong>No se encontraron cambios con estos criterios.</strong><span>{priceChangeActiveFilters.length ? "Elimina uno o varios filtros para ampliar los resultados." : "Todavía no existen movimientos de precio en este período."}</span>{priceChangeActiveFilters.length > 0 && <button type="button" className="secondary-button" onClick={clearPriceChangeFilters}>Limpiar filtros</button>}</div> : <div className="table-scroll" tabIndex={0} aria-label="Tabla de cambios de precios DAKA; desplázate horizontalmente si es necesario"><table className="changes-table"><caption className="sr-only">Productos DAKA con cambios de precio en el período seleccionado</caption><thead><tr><th scope="col">Producto</th><th scope="col">Cambios</th><th scope="col">Precio inicial → final</th><th scope="col">Diferencia</th><th scope="col">Último cambio</th></tr></thead><tbody>{changeProducts.map((product) => <tr key={product.id} tabIndex={0} aria-current={selected?.id === product.id ? "true" : undefined} className={selected?.id === product.id ? "selected-change" : ""} onClick={() => setSelected(product)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(product); } }}><td><b>{product.name}</b><small>{product.externalId}</small></td><td><strong>{product.changeCount}</strong><small>movimientos</small></td><td>{product.initialPrice == null || product.finalPrice == null ? "—" : `${money.format(product.initialPrice)} → ${money.format(product.finalPrice)}`}</td><td className={changeClass(product.netDifferenceUsd)}><span className={`movement-indicator ${changeClass(product.netDifferenceUsd)}`}>{movementLabel(product.netDifferenceUsd)}</span><b>{product.netDifferenceUsd == null ? "—" : `${product.netDifferenceUsd > 0 ? "+" : ""}${money.format(product.netDifferenceUsd)}`}</b><small>{product.netChangePct == null ? "" : `${product.netChangePct > 0 ? "+" : ""}${product.netChangePct.toFixed(1)}% acumulado`}</small></td><td>{formatDate(product.latestChangeAt)}</td></tr>)}</tbody></table></div>}
                {changeProducts.length > 0 && <div className="changes-load-more">{hasMoreChanges ? <button onClick={() => void loadMoreChanges()} disabled={loadingMoreChanges}>{loadingMoreChanges ? "Cargando…" : "Cargar 50 productos más"}</button> : <span>Se mostraron todos los productos con cambios</span>}</div>}
              </article>
              <article className="change-detail-card">
                {selectedChange ? <><div className="change-detail-head"><div><span className="eyebrow-dark">Detalle del período</span><h2>{selectedChange.name}</h2><p>SAP {selectedChange.externalId} · {selectedChange.changeCount} cambios {changeDays === "1" ? "durante el día" : changeDays === "all" ? "en todo el histórico" : `en ${changeDays} días`}</p><button className="history-link-button" onClick={() => openProductHistory(selectedChange)}>Ver todas las capturas del producto</button></div><div className={changeClass(selectedChange.netDifferenceUsd)}><strong>{selectedChange.netDifferenceUsd == null ? "—" : `${selectedChange.netDifferenceUsd > 0 ? "+" : ""}${money.format(selectedChange.netDifferenceUsd)}`}</strong><span>{selectedChange.netChangePct == null ? "Sin comparación" : `${selectedChange.netChangePct > 0 ? "+" : ""}${selectedChange.netChangePct.toFixed(1)}% acumulado`}</span></div></div>
                  {history.length > 0 && <><div className="chart-caption">Evolución de las capturas guardadas · coloca el cursor sobre un punto para ver su fecha y precio</div><svg className="price-chart change-chart" viewBox="0 0 760 245" role="img" aria-label="Evolución histórica del precio"><line className="chart-grid" x1="45" y1="45" x2="735" y2="45"/><line className="chart-grid" x1="45" y1="115" x2="735" y2="115"/><line className="chart-grid" x1="45" y1="190" x2="735" y2="190"/><path className="chart-line" d={chart.line}/>{chart.dots.map((dot, index) => <circle key={`${dot.scrapedAt}-${index}`} className="chart-point" cx={dot.x} cy={dot.y} r="4"><title>{`${formatDate(dot.scrapedAt)} · ${money.format(dot.price)}`}</title></circle>)}</svg><div className="mini-grid change-history-summary"><div><span>Precio máximo</span><b>{maxPrice == null ? "—" : money.format(maxPrice)}</b></div><div><span>Precio mínimo</span><b>{minPrice == null ? "—" : money.format(minPrice)}</b></div><div><span>Capturas guardadas</span><b>{integer.format(historyTotal)}</b></div><div><span>Cambios del período</span><b>{integer.format(selectedChange.changeCount)}</b></div></div></>}
                  <div className="history-table"><div className="section-head"><div><h2>Historial de cambios de precio</h2><small className="section-explanation">Solo se muestran las capturas donde el precio cambió.</small></div><small>{movementsLoading ? "Consultando…" : `Mostrando ${integer.format(movements.length)} de ${integer.format(movementTotal)}`}</small></div>{movementsLoading ? <div className="empty-state">Cargando movimientos…</div> : <><div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Precio anterior</th><th>Precio nuevo</th><th>Diferencia USD</th><th>Variación</th></tr></thead><tbody>{movements.map((point) => <tr key={point.scrapedAt}><td>{formatDate(point.scrapedAt)}</td><td>{point.previousPrice == null ? "—" : money.format(point.previousPrice)}</td><td>{point.price == null ? "Sin precio" : money.format(point.price)}</td><td className={changeClass(point.differenceUsd)}>{point.differenceUsd == null ? "—" : `${point.differenceUsd > 0 ? "+" : ""}${money.format(point.differenceUsd)}`}</td><td className={changeClass(point.changePct)}>{point.changePct == null ? "—" : `${point.changePct > 0 ? "+" : ""}${point.changePct.toFixed(1)}%`}</td></tr>)}</tbody></table></div><div className="changes-load-more">{hasMoreMovements ? <button onClick={() => void loadMoreMovements()} disabled={loadingMoreMovements}>{loadingMoreMovements ? "Cargando…" : "Cargar 50 movimientos más"}</button> : <span>{movementTotal ? "Se mostraron todos los cambios reales del período" : "No existen cambios con estos filtros"}</span>}</div></>}</div></> : <div className="empty-state detail-empty">Selecciona un producto para visualizar todos sus movimientos.</div>}
              </article>
            </section>
          </> : priceTab === "damasco"
            ? <DamascoCatalog canAdmin={currentRole === "admin"} reportComparison={reportComparison}/>
            : priceTab === "catalogChanges"
              ? <CatalogChanges/>
              : priceTab === "competitors"
                ? <CompetitorComparison canAdmin={currentRole === "admin"}/>
                : <CommercialOpportunities canAdmin={currentRole === "admin"}/>}
          <section className="roadmap"><div><strong>Benchmarking competitivo habilitado con Damasco, Multimax, IVOO, Venelectronics y SoyTechno</strong><span>La arquitectura mantiene cada fuente separada y permite sumar nuevas tiendas sin perder trazabilidad.</span></div><div className="stages"><span className="stage">Fase 1 · DAKA</span><span>→</span><span className="stage">Fase 2 · Damasco</span><span>→</span><span className="stage">Fase 3 · Multimax</span><span>→</span><span className="stage">Fase 4 · IVOO</span><span>→</span><span className="stage">Fase 5 · Venelectronics</span><span>→</span><span className="stage">Fase 6 · SoyTechno</span></div></section>
        </main>
      ) : view === "universe" ? <main><DakaProductUniverse canAdmin={currentRole === "admin"}/></main>
        : <TechnicalMonitoring jobs={jobs} sources={monitoringSources} latestRequest={latestRequest} running={running} reportSending={reportSending} canAdmin={currentRole === "admin"} onTriggerDaka={triggerScrape} onSendTelegramReport={sendTelegramReport}/>}
    </div>
  );
}
