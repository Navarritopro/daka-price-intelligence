"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { caracasToday, shiftIsoDate, type CatalogPeriodMode } from "@/lib/catalog-comparison";

type Source = "all" | "daka" | "damasco" | "multimax" | "ivoo" | "venelectronics" | "soytechno";
type ChangeState = "missing" | "confirmed" | "new" | "recovered";
type CatalogItem = {
  id: number; externalId: string; name: string; brand: string | null; category: string | null;
  url: string; imageUrl: string | null; source: Exclude<Source, "all">; sourceName: string;
  state: ChangeState; consecutiveAbsences: number; firstSeenAt: string | null; lastSeenAt: string | null;
  missingSince: string | null; lastPrice: number | null; currentPrice: number | null;
  lastInStock: boolean | null; currentInStock: boolean | null;
  lastQuantity: number | null; currentQuantity: number | null;
};
type Comparison = {
  source: string; sourceName: string; previousFinishedAt: string | null; currentFinishedAt: string | null;
  previousProducts: number; currentProducts: number; ready: boolean;
};
type CatalogPage = {
  period: { mode: CatalogPeriodMode; startDate: string | null; endDate: string | null; label: string };
  items: CatalogItem[]; total: number; hasMore: boolean;
  stats: { missing: number; confirmed: number; newProducts: number; recovered: number };
  comparisons: Comparison[]; categories: string[]; brands: string[]; error?: string;
};
type HistoryPoint = {
  jobId: string; date: string; finishedAt: string; detected: boolean; consecutiveAbsences: number;
  price: number | null; listPrice: number | null; inStock: boolean | null;
  availableQuantity: number | null; scrapedAt: string | null;
};
type ProductHistory = { points: HistoryPoint[]; error?: string };

const BATCH_SIZE = 50;
const integer = new Intl.NumberFormat("es-VE");
const money = new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD" });
const dateTime = new Intl.DateTimeFormat("es-VE", {
  timeZone: "America/Caracas", day: "2-digit", month: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit"
});
const day = new Intl.DateTimeFormat("es-VE", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
const STATE_LABELS: Record<ChangeState, string> = {
  missing: "No detectado", confirmed: "Ausencia confirmada", new: "Producto nuevo", recovered: "Reapareció"
};

function formatDate(value: string | null) {
  return value ? `${dateTime.format(new Date(value))} VET` : "Sin registro";
}

function formatDay(value: string) {
  return day.format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

function stockLabel(quantity: number | null, stock: boolean | null) {
  if (quantity != null) return `${integer.format(quantity)} unidades`;
  if (stock === true) return "Disponible · sin cantidad";
  if (stock === false) return "Sin stock";
  return "No reportado";
}

export default function CatalogChanges() {
  const today = useMemo(caracasToday, []);
  const [source, setSource] = useState<Source>("all");
  const [period, setPeriod] = useState<CatalogPeriodMode>("latest");
  const [startDate, setStartDate] = useState(shiftIsoDate(today, -7));
  const [endDate, setEndDate] = useState(today);
  const [state, setState] = useState("all");
  const [absence, setAbsence] = useState("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [page, setPage] = useState<CatalogPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [history, setHistory] = useState<ProductHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => { setBrand(""); setCategory(""); }, [source]);

  const parameters = useCallback((offset: number, requestedLimit = BATCH_SIZE) => {
    const params = new URLSearchParams({
      source, period, state, absence, search: debouncedSearch, brand, category,
      offset: String(offset), limit: String(requestedLimit)
    });
    if (period === "custom") { params.set("startDate", startDate); params.set("endDate", endDate); }
    return params;
  }, [absence, brand, category, debouncedSearch, endDate, period, source, startDate, state]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setItems([]); setPage(null); setSelected(null);
    fetch(`/api/catalog-changes?${parameters(0)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as CatalogPage;
        if (!response.ok) throw new Error(payload.error ?? "Cambios de catálogo no disponibles");
        return payload;
      })
      .then((payload) => { setPage(payload); setItems(payload.items); })
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError(requestError instanceof Error ? requestError.message : "No fue posible cargar los cambios de catálogo");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [parameters]);

  const loadMore = useCallback(async () => {
    if (!page?.hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(`/api/catalog-changes?${parameters(items.length)}`, { cache: "no-store" });
      const payload = await response.json() as CatalogPage;
      if (!response.ok) throw new Error(payload.error ?? "No fue posible cargar más productos");
      setItems((current) => [...current, ...payload.items]); setPage(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible cargar más productos");
    } finally { setLoadingMore(false); }
  }, [items.length, loadingMore, page?.hasMore, parameters]);

  const closeDetail = useCallback(() => {
    setSelected(null); setHistory(null);
    window.setTimeout(() => detailTriggerRef.current?.focus(), 0);
  }, []);

  const openDetail = useCallback((item: CatalogItem, trigger: HTMLButtonElement) => {
    detailTriggerRef.current = trigger; setSelected(item);
  }, []);

  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDetail();
      if (event.key === "Tab" && drawerRef.current) {
        const focusable = [...drawerRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')];
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", keydown); };
  }, [closeDetail, selected]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (period === "custom") { params.set("startDate", startDate); params.set("endDate", endDate); }
    else if (period === "today") { params.set("startDate", shiftIsoDate(today, -1)); params.set("endDate", today); }
    else if (period === "7" || period === "30") { params.set("startDate", shiftIsoDate(today, -Number(period))); params.set("endDate", today); }
    setHistoryLoading(true); setHistory(null);
    fetch(`/api/catalog-changes/${selected.id}?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as ProductHistory;
        if (!response.ok) throw new Error(payload.error ?? "Historial no disponible");
        return payload;
      })
      .then(setHistory)
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError(requestError instanceof Error ? requestError.message : "No fue posible cargar el historial");
      })
      .finally(() => setHistoryLoading(false));
    return () => controller.abort();
  }, [endDate, period, selected, startDate, today]);

  const stats = page?.stats;
  const unavailableComparisons = page?.comparisons.filter((comparison) => !comparison.ready) ?? [];
  const comparisonLabel = page?.comparisons.length === 1 && page.comparisons[0].ready
    ? `${formatDate(page.comparisons[0].previousFinishedAt)} → ${formatDate(page.comparisons[0].currentFinishedAt)}`
    : page?.period.label ?? "Preparando comparación";

  const exportExcel = useCallback(async () => {
    if (!page?.total || exporting) return;
    setExporting(true); setError(null);
    try {
      const exported: CatalogItem[] = [];
      for (let offset = 0; offset < page.total; offset += 200) {
        const response = await fetch(`/api/catalog-changes?${parameters(offset, 200)}`, { cache: "no-store" });
        const payload = await response.json() as CatalogPage;
        if (!response.ok) throw new Error(payload.error ?? "No fue posible preparar la exportación");
        exported.push(...payload.items);
        if (!payload.hasMore) break;
      }
      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "DAKA Price Lab";
      const sheet = workbook.addWorksheet("Cambios de catálogo", { views: [{ state: "frozen", ySplit: 1 }] });
      sheet.columns = [
        { header: "Fuente", key: "source", width: 18 }, { header: "Estado", key: "state", width: 23 },
        { header: "Producto", key: "name", width: 48 }, { header: "Referencia", key: "externalId", width: 20 },
        { header: "Marca", key: "brand", width: 18 }, { header: "Categoría", key: "category", width: 24 },
        { header: "Última aparición", key: "lastSeenAt", width: 23 }, { header: "Ausente desde", key: "missingSince", width: 23 },
        { header: "Ausencias consecutivas", key: "absences", width: 22 }, { header: "Último precio USD", key: "price", width: 18 },
        { header: "Última disponibilidad", key: "stock", width: 25 }, { header: "URL", key: "url", width: 60 }
      ];
      for (const item of exported) sheet.addRow({
        source: item.sourceName, state: STATE_LABELS[item.state], name: item.name, externalId: item.externalId,
        brand: item.brand ?? "", category: item.category ?? "", lastSeenAt: formatDate(item.lastSeenAt),
        missingSince: item.missingSince ? formatDate(item.missingSince) : "", absences: item.consecutiveAbsences,
        price: item.lastPrice, stock: stockLabel(item.lastQuantity, item.lastInStock), url: item.url
      });
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF003288" } };
      sheet.autoFilter = { from: "A1", to: "L1" };
      sheet.getColumn("price").numFmt = "$#,##0.00";
      const buffer = await workbook.xlsx.writeBuffer();
      const bytes = new Uint8Array(buffer);
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href; anchor.download = `cambios-catalogo-${today}.xlsx`; anchor.click();
      URL.revokeObjectURL(href);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "No fue posible generar el archivo Excel");
    } finally { setExporting(false); }
  }, [exporting, page?.total, parameters, today]);

  return <section className="catalog-changes">
    <div className="catalog-changes-head" data-tour="catalog-changes-head"><div><span className="eyebrow-dark">Auditoría competitiva · Presencia de catálogo</span><h2>Cambios de catálogo</h2><p>Identifica productos ausentes, nuevos y recuperados comparando únicamente ejecuciones exitosas con datos guardados.</p></div><div><span>Comparación aplicada</span><strong>{comparisonLabel}</strong><button className="catalog-export-button" onClick={() => void exportExcel()} disabled={!page?.total || exporting}>{exporting ? "Preparando Excel…" : "Descargar Excel"}</button></div></div>

    <div className="catalog-change-summary">
      <article className="catalog-missing"><span>No detectados · primera ausencia</span><strong>{loading ? "…" : integer.format(stats?.missing ?? 0)}</strong></article>
      <article className="catalog-confirmed"><span>Ausencias confirmadas</span><strong>{loading ? "…" : integer.format(stats?.confirmed ?? 0)}</strong><small>2 o más capturas consecutivas</small></article>
      <article className="catalog-new"><span>Productos nuevos</span><strong>{loading ? "…" : integer.format(stats?.newProducts ?? 0)}</strong></article>
      <article className="catalog-recovered"><span>Productos que reaparecieron</span><strong>{loading ? "…" : integer.format(stats?.recovered ?? 0)}</strong></article>
    </div>

    <div className="catalog-comparison-grid" aria-label="Totales de las capturas comparadas">{page?.comparisons.filter((comparison) => comparison.ready).map((comparison) => {
      const difference = comparison.currentProducts - comparison.previousProducts;
      return <article key={comparison.source}><span className={`catalog-source ${comparison.source}`}>{comparison.sourceName}</span><div><strong>{integer.format(comparison.previousProducts)} → {integer.format(comparison.currentProducts)}</strong><small className={difference < 0 ? "negative" : difference > 0 ? "positive" : "neutral"}>{difference > 0 ? "+" : ""}{integer.format(difference)} productos</small></div></article>;
    })}</div>

    <div className="catalog-period-controls" data-tour="catalog-changes-filters">
      <label>Periodo<select value={period} onChange={(event) => setPeriod(event.target.value as CatalogPeriodMode)}><option value="latest">Últimas dos capturas completas</option><option value="today">Ayer vs. hoy</option><option value="7">Hace 7 días vs. hoy</option><option value="30">Hace 30 días vs. hoy</option><option value="custom">Fecha personalizada</option></select></label>
      {period === "custom" && <><label>Desde<input type="date" max={shiftIsoDate(endDate, -1)} value={startDate} onChange={(event) => setStartDate(event.target.value)}/></label><label>Hasta<input type="date" min={shiftIsoDate(startDate, 1)} max={today} value={endDate} onChange={(event) => setEndDate(event.target.value)}/></label></>}
    </div>

    <div className="catalog-change-filters">
      <input aria-label="Buscar cambio de catálogo" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto, referencia o marca"/>
      <select aria-label="Fuente" value={source} onChange={(event) => setSource(event.target.value as Source)}><option value="all">DAKA y todos los competidores</option><option value="daka">DAKA</option><option value="damasco">Damasco</option><option value="multimax">Multimax</option><option value="ivoo">IVOO</option><option value="venelectronics">Venelectronics</option><option value="soytechno">SoyTechno</option></select>
      <select aria-label="Estado de catálogo" value={state} onChange={(event) => setState(event.target.value)}><option value="all">Todos los cambios</option><option value="missing">No detectados</option><option value="confirmed">Ausencia confirmada</option><option value="new">Productos nuevos</option><option value="recovered">Reaparecieron</option></select>
      <select aria-label="Ausencias consecutivas" value={absence} onChange={(event) => setAbsence(event.target.value)}><option value="all">Cualquier número de ausencias</option><option value="1">1 captura</option><option value="2-3">2 a 3 capturas</option><option value="4+">4 o más capturas</option></select>
      <select aria-label="Marca" value={brand} onChange={(event) => setBrand(event.target.value)}><option value="">Todas las marcas</option>{page?.brands.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      <select aria-label="Categoría" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Todas las categorías</option>{page?.categories.map((value) => <option key={value} value={value}>{value}</option>)}</select>
    </div>

    {unavailableComparisons.length > 0 && <div className="catalog-comparison-warning"><strong>Comparación parcial</strong><span>No existen dos capturas válidas para: {unavailableComparisons.map((item) => item.sourceName).join(", ")}. Estas fuentes no generan falsos productos ausentes.</span></div>}
    {error && <div className="error-banner"><strong>Consulta pendiente</strong><span>{error}</span></div>}

    <article className="catalog-change-table-card" data-tour="catalog-changes-table">
      <div className="section-head"><div><h2>Productos con cambios de presencia</h2><small>“No detectado” no significa eliminado hasta validar el enlace o confirmar dos capturas consecutivas.</small></div><small>{loading ? "Comparando…" : `Mostrando ${integer.format(items.length)} de ${integer.format(page?.total ?? 0)}`}</small></div>
      {loading ? <div className="empty-state">Comparando las capturas seleccionadas…</div> : !items.length ? <div className="empty-state">No se encontraron cambios con los filtros seleccionados.</div> : <div className="table-scroll"><table className="catalog-change-table"><thead><tr><th>Producto</th><th>Fuente</th><th>Estado</th><th>Última aparición</th><th>Ausencias</th><th>Último precio</th><th>Última disponibilidad</th><th>Validación</th></tr></thead><tbody>{items.map((item) => <tr key={`${item.source}-${item.id}`}><td><strong>{item.name}</strong><small>Ref. {item.externalId}{item.brand ? ` · ${item.brand}` : ""}{item.category ? ` · ${item.category}` : ""}</small></td><td><span className={`catalog-source ${item.source}`}>{item.sourceName}</span></td><td><span className={`catalog-state ${item.state}`}>{STATE_LABELS[item.state]}</span></td><td>{formatDate(item.lastSeenAt)}<small>{item.missingSince ? `Ausente desde ${formatDate(item.missingSince)}` : ""}</small></td><td><strong>{item.consecutiveAbsences ? integer.format(item.consecutiveAbsences) : "—"}</strong><small>{item.consecutiveAbsences === 1 ? "captura" : item.consecutiveAbsences ? "capturas" : "Producto presente"}</small></td><td>{item.lastPrice == null ? "Sin precio" : money.format(item.lastPrice)}</td><td>{stockLabel(item.lastQuantity, item.lastInStock)}</td><td><div className="catalog-row-actions"><a href={item.url} target="_blank" rel="noreferrer">Abrir producto ↗</a><button onClick={(event) => openDetail(item, event.currentTarget)}>Ver histórico</button></div></td></tr>)}</tbody></table></div>}
      <div className="changes-load-more">{page?.hasMore ? <button onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "Cargando…" : "Cargar 50 productos más"}</button> : items.length ? <span>Se mostraron todos los cambios del periodo</span> : null}</div>
    </article>

    {selected && <div className="catalog-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetail(); }}><aside ref={drawerRef} className="catalog-drawer" role="dialog" aria-modal="true" aria-labelledby="catalog-detail-title"><header><div><span className={`catalog-source ${selected.source}`}>{selected.sourceName}</span><h2 id="catalog-detail-title">{selected.name}</h2><small>Ref. {selected.externalId} · {selected.brand ?? "Marca no informada"}</small></div><button ref={closeButtonRef} onClick={closeDetail} aria-label="Cerrar detalle">×</button></header><div className="catalog-drawer-body"><div className={`catalog-detail-status ${selected.state}`}><strong>{STATE_LABELS[selected.state]}</strong><span>{selected.state === "confirmed" ? `${selected.consecutiveAbsences} capturas consecutivas sin detectarse` : selected.state === "missing" ? "Primera captura en la que no fue detectado" : selected.state === "new" ? "Aparece por primera vez en el periodo comparado" : "Volvió a detectarse después de una ausencia"}</span></div><div className="catalog-detail-actions"><a href={selected.url} target="_blank" rel="noreferrer">Validar producto en el sitio ↗</a><span>La validación se abre en una pestaña nueva.</span></div><div className="catalog-detail-metrics"><div><span>Primera aparición</span><strong>{formatDate(selected.firstSeenAt)}</strong></div><div><span>Última aparición</span><strong>{formatDate(selected.lastSeenAt)}</strong></div><div><span>Último precio</span><strong>{selected.lastPrice == null ? "Sin precio" : money.format(selected.lastPrice)}</strong></div><div><span>Disponibilidad conocida</span><strong>{stockLabel(selected.lastQuantity, selected.lastInStock)}</strong></div></div><div className="catalog-presence-history"><div className="section-head"><div><h3>Historial de presencia</h3><small>Última ejecución exitosa de cada día dentro del periodo.</small></div></div>{historyLoading ? <div className="empty-state">Cargando historial…</div> : !history?.points.length ? <div className="empty-state">No existen capturas dentro del periodo.</div> : <div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Presencia</th><th>Precio</th><th>Disponibilidad</th></tr></thead><tbody>{history.points.map((point) => <tr key={point.jobId}><td>{formatDay(point.date)}</td><td><span className={`presence-state ${point.detected ? "detected" : point.consecutiveAbsences >= 2 ? "confirmed" : "missing"}`}>{point.detected ? "Detectado" : point.consecutiveAbsences >= 2 ? `Ausente · ${point.consecutiveAbsences}` : "No detectado"}</span></td><td>{point.price == null ? "—" : money.format(point.price)}</td><td>{point.detected ? stockLabel(point.availableQuantity, point.inStock) : "—"}</td></tr>)}</tbody></table></div>}</div></div></aside></div>}
  </section>;
}
