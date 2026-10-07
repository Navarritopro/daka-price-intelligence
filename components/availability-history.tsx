"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AvailabilitySource } from "@/components/competitor-availability";

type Metric = "products" | "units";
type HistoryMovement = "up" | "down" | "same" | "restocked" | "out" | "unquantified";
type SeriesPoint = {
  source: Exclude<AvailabilitySource, "all">; sourceName: string; date: string;
  capturedProducts: number; availableProducts: number; unavailableProducts: number;
  unknownProducts: number; unquantifiedProducts: number; reportedUnits: number;
};
type HistoryItem = {
  id: number; externalId: string; name: string; brand: string | null; category: string | null; url: string;
  source: Exclude<AvailabilitySource, "all">; sourceName: string; captureDays: number;
  firstQuantity: number | null; latestQuantity: number | null; minimumQuantity: number | null;
  maximumQuantity: number | null; firstAvailable: boolean | null; latestAvailable: boolean | null;
  firstDate: string; latestDate: string; movement: HistoryMovement; quantityDifference: number | null;
};
type HistoryPage = {
  series: SeriesPoint[]; items: HistoryItem[]; total: number; hasMore: boolean;
  stats: { availableStart: number; availableEnd: number; availableNet: number; unitsStart: number;
    unitsEnd: number; unitsNet: number; enteredStock: number; leftStock: number; unquantifiedEnd: number };
  categories: string[]; brands: string[]; error?: string;
};
type ProductPoint = { date: string; quantity: number | null; previousQuantity: number | null; difference: number | null; available: boolean | null };
type ProductHistory = { product: { id: number; externalId: string; name: string; category: string | null; url: string; source: string; sourceName: string }; points: ProductPoint[]; error?: string };

const BATCH_SIZE = 50;
const integer = new Intl.NumberFormat("es-VE");
const shortDate = new Intl.DateTimeFormat("es-VE", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
const SOURCE_COLORS: Record<string, string> = { daka: "#003288", damasco: "#B53112", multimax: "#053AED", ivoo: "#05A94E", venelectronics: "#73A851", soytechno: "#29B6F6" };
const movementLabels: Record<HistoryMovement, string> = {
  up: "↑ Aumentó", down: "↓ Disminuyó", same: "• Sin variación", restocked: "↗ Ingresó stock",
  out: "× Se agotó", unquantified: "Cantidad no determinada"
};

function caracasToday() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Caracas", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function shiftDate(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function formatDay(value: string) {
  return shortDate.format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

function quantity(value: number | null, available: boolean | null) {
  if (value != null) return `${integer.format(value)} unidades`;
  if (available === true) return "Disponible · sin cantidad";
  if (available === false) return "Sin stock";
  return "Sin dato";
}

function lineChart(points: SeriesPoint[], metric: Metric) {
  const dates = [...new Set(points.map((point) => point.date.slice(0, 10)))].sort();
  const values = points.map((point) => metric === "products" ? point.availableProducts : point.reportedUnits);
  const maximum = Math.max(...values, 1);
  const grouped = new Map<string, SeriesPoint[]>();
  for (const point of points) grouped.set(point.source, [...(grouped.get(point.source) ?? []), point]);
  const lines = [...grouped.entries()].map(([source, sourcePoints]) => {
    const usable = [...sourcePoints].sort((a, b) => a.date.localeCompare(b.date));
    const dots = usable.map((point) => {
      const dateIndex = dates.indexOf(point.date.slice(0, 10));
      const value = metric === "products" ? point.availableProducts : point.reportedUnits;
      return { x: 55 + (dateIndex / Math.max(dates.length - 1, 1)) * 800, y: 225 - (value / maximum) * 180, value, point };
    });
    return { source, name: usable[0]?.sourceName ?? source, color: SOURCE_COLORS[source] ?? "#64748b", dots, path: dots.map((dot, index) => `${index ? "L" : "M"}${dot.x.toFixed(1)} ${dot.y.toFixed(1)}`).join(" ") };
  });
  return { dates, maximum, lines };
}

function productChart(points: ProductPoint[]) {
  const usable = points.filter((point): point is ProductPoint & { quantity: number } => point.quantity != null);
  if (!usable.length) return { path: "", dots: [] as Array<{ x: number; y: number; point: ProductPoint & { quantity: number } }>, maximum: 0 };
  const maximum = Math.max(...usable.map((point) => point.quantity), 1);
  const dots = usable.map((point, index) => ({
    x: 45 + (index / Math.max(usable.length - 1, 1)) * 690,
    y: 190 - (point.quantity / maximum) * 145,
    point
  }));
  return { maximum, dots, path: dots.map((dot, index) => `${index ? "L" : "M"}${dot.x.toFixed(1)} ${dot.y.toFixed(1)}`).join(" ") };
}

export default function AvailabilityHistory({ source }: { source: AvailabilitySource }) {
  const today = useMemo(caracasToday, []);
  const [days, setDays] = useState("30");
  const [startDate, setStartDate] = useState(shiftDate(today, -29));
  const [endDate, setEndDate] = useState(today);
  const [metric, setMetric] = useState<Metric>("products");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [movement, setMovement] = useState("all");
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<HistoryItem | null>(null);
  const [productHistory, setProductHistory] = useState<ProductHistory | null>(null);
  const [productLoading, setProductLoading] = useState(false);
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => { setCategory(""); setBrand(""); setSelected(null); }, [source]);

  const closeDetail = useCallback(() => {
    setSelected(null);
    const trigger = detailTriggerRef.current;
    window.setTimeout(() => trigger?.focus(), 0);
  }, []);

  const openDetail = useCallback((item: HistoryItem, trigger: HTMLButtonElement) => {
    detailTriggerRef.current = trigger;
    setSelected(item);
  }, []);

  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDetail();
      if (event.key === "Tab" && drawerRef.current) {
        const focusable = [...drawerRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')];
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeDetail, selected]);

  const parameters = useCallback((offset: number) => {
    const params = new URLSearchParams({ source, days, search: debouncedSearch, category, brand, movement, limit: String(BATCH_SIZE), offset: String(offset) });
    if (days === "custom") { params.set("startDate", startDate); params.set("endDate", endDate); }
    return params;
  }, [brand, category, days, debouncedSearch, endDate, movement, source, startDate]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setPage(null); setItems([]); setSelected(null); setProductHistory(null);
    fetch(`/api/availability-history?${parameters(0)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as HistoryPage;
        if (!response.ok) throw new Error(payload.error ?? "Histórico no disponible");
        return payload;
      })
      .then((payload) => { setPage(payload); setItems(payload.items); })
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError(requestError instanceof Error ? requestError.message : "No fue posible cargar el histórico");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [parameters]);

  const loadMore = useCallback(async () => {
    if (!page?.hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(`/api/availability-history?${parameters(items.length)}`, { cache: "no-store" });
      const payload = await response.json() as HistoryPage;
      if (!response.ok) throw new Error(payload.error ?? "No fue posible cargar más productos");
      setItems((current) => [...current, ...payload.items]); setPage(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible cargar más productos");
    } finally { setLoadingMore(false); }
  }, [items.length, loadingMore, page?.hasMore, parameters]);

  useEffect(() => {
    if (!selected) { setProductHistory(null); return; }
    const controller = new AbortController();
    setProductLoading(true); setProductHistory(null);
    const params = new URLSearchParams({ days });
    if (days === "custom") { params.set("startDate", startDate); params.set("endDate", endDate); }
    fetch(`/api/availability-history/${selected.id}?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as ProductHistory;
        if (!response.ok) throw new Error(payload.error ?? "Detalle no disponible");
        return payload;
      })
      .then(setProductHistory)
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError(requestError instanceof Error ? requestError.message : "No fue posible cargar el producto");
      })
      .finally(() => setProductLoading(false));
    return () => controller.abort();
  }, [days, endDate, selected, startDate]);

  const chart = useMemo(() => lineChart(page?.series ?? [], metric), [metric, page?.series]);
  const detailChart = useMemo(() => productChart(productHistory?.points ?? []), [productHistory?.points]);
  const stats = page?.stats;
  const startValue = metric === "products" ? stats?.availableStart : stats?.unitsStart;
  const endValue = metric === "products" ? stats?.availableEnd : stats?.unitsEnd;
  const netValue = metric === "products" ? stats?.availableNet : stats?.unitsNet;

  return <section className="availability-history">
    <div className="availability-head"><div><span className="eyebrow-dark">Inteligencia competitiva · Inventario histórico</span><h2>Histórico de disponibilidad</h2><p>Consulta la evolución diaria usando la última ejecución exitosa de cada fuente.</p></div><div><span>Alcance</span><strong>DAKA y competidores · zona horaria VET</strong></div></div>

    <div className="availability-history-controls">
      <div className="history-period-control"><label htmlFor="availability-period">Periodo</label><select id="availability-period" value={days} onChange={(event) => setDays(event.target.value)}><option value="7">Últimos 7 días</option><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option><option value="custom">Fecha personalizada</option></select></div>
      {days === "custom" && <div className="availability-custom-dates"><label>Desde<input type="date" max={endDate} value={startDate} onChange={(event) => setStartDate(event.target.value)}/></label><label>Hasta<input type="date" min={startDate} max={today} value={endDate} onChange={(event) => setEndDate(event.target.value)}/></label></div>}
      <div className="availability-metric-toggle" role="group" aria-label="Métrica del histórico"><button className={metric === "products" ? "active" : ""} onClick={() => setMetric("products")}>Productos disponibles</button><button className={metric === "units" ? "active" : ""} onClick={() => setMetric("units")}>Unidades reportadas</button></div>
    </div>

    <div className="availability-summary history-summary">
      <article><span>{metric === "products" ? "Disponibles al inicio" : "Unidades al inicio"}</span><strong>{loading ? "…" : integer.format(startValue ?? 0)}</strong></article>
      <article><span>{metric === "products" ? "Disponibles al cierre" : "Unidades al cierre"}</span><strong>{loading ? "…" : integer.format(endValue ?? 0)}</strong></article>
      <article className={(netValue ?? 0) >= 0 ? "availability-up" : "availability-down"}><span>Cambio neto</span><strong>{loading ? "…" : `${(netValue ?? 0) > 0 ? "+" : ""}${integer.format(netValue ?? 0)}`}</strong></article>
      <article className="availability-up"><span>Entraron en disponibilidad</span><strong>{loading ? "…" : integer.format(stats?.enteredStock ?? 0)}</strong></article>
      <article className="availability-down"><span>Salieron de disponibilidad</span><strong>{loading ? "…" : integer.format(stats?.leftStock ?? 0)}</strong></article>
      <article><span>Disponibles sin cantidad</span><strong>{loading ? "…" : integer.format(stats?.unquantifiedEnd ?? 0)}</strong></article>
    </div>

    {error && <div className="error-banner"><strong>Consulta pendiente</strong><span>{error}</span></div>}
    <article className="availability-chart-card">
      <div className="section-head"><div><h2>{metric === "products" ? "Productos disponibles por fecha" : "Unidades reportadas por fecha"}</h2><small>{metric === "units" ? "Las cantidades se reflejan literalmente como las publica cada fuente, incluidos valores altos como 99.999." : "Cada punto corresponde a la última ejecución exitosa de ese día."}</small></div></div>
      {loading ? <div className="empty-state">Construyendo la evolución histórica…</div> : !chart.lines.length ? <div className="empty-state">No hay capturas exitosas para este periodo.</div> : <>
        <div className="availability-chart-legend">{chart.lines.map((line) => <span key={line.source}><i style={{ background: line.color }}/>{line.name}</span>)}</div>
        <div className="availability-chart-scroll"><svg className="availability-line-chart" viewBox="0 0 900 270" role="img" aria-label={`Histórico de ${metric === "products" ? "productos disponibles" : "unidades reportadas"}`}>
          {[45, 105, 165, 225].map((y) => <line key={y} x1="55" x2="855" y1={y} y2={y} className="chart-grid"/>)}
          <text x="7" y="49">{integer.format(chart.maximum)}</text><text x="25" y="229">0</text>
          {chart.lines.map((line) => <g key={line.source}><path d={line.path} fill="none" stroke={line.color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>{line.dots.map((dot) => <circle key={`${line.source}-${dot.point.date}`} cx={dot.x} cy={dot.y} r="4" fill="#fff" stroke={line.color} strokeWidth="3"><title>{`${line.name} · ${formatDay(dot.point.date)} · ${integer.format(dot.value)}`}</title></circle>)}</g>)}
          {chart.dates.length > 0 && <><text x="55" y="258">{formatDay(chart.dates[0])}</text><text x="855" y="258" textAnchor="end">{formatDay(chart.dates[chart.dates.length - 1])}</text></>}
        </svg></div>
      </>}
    </article>

    <div className="availability-filters history-detail-filters">
      <input aria-label="Buscar producto en el histórico" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto, referencia, marca o modelo"/>
      <select aria-label="Marca histórica" value={brand} onChange={(event) => setBrand(event.target.value)}><option value="">Todas las marcas</option>{page?.brands.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      <select aria-label="Movimiento histórico" value={movement} onChange={(event) => setMovement(event.target.value)}><option value="all">Todos los movimientos</option><option value="up">Aumentó</option><option value="down">Disminuyó</option><option value="same">Sin variación</option><option value="restocked">Ingresó stock</option><option value="out">Se agotó</option><option value="unquantified">Sin cantidad exacta</option></select>
      <select aria-label="Categoría histórica" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Todas las categorías</option>{page?.categories.map((value) => <option key={value} value={value}>{value}</option>)}</select>
    </div>

    <article className="availability-table-card">
      <div className="section-head"><div><h2>Comportamiento por producto</h2><small>{loading ? "Analizando capturas…" : `Mostrando ${integer.format(items.length)} de ${integer.format(page?.total ?? 0)}`}</small></div></div>
      {loading ? <div className="empty-state">Comparando el periodo seleccionado…</div> : !items.length ? <div className="empty-state">No existen productos con estos filtros.</div> : <div className="table-scroll"><table className="availability-history-table"><thead><tr><th>Producto</th><th>Fuente</th><th>Inicio</th><th>Cierre</th><th>Mínimo</th><th>Máximo</th><th>Variación</th><th>Movimiento</th><th>Detalle</th></tr></thead><tbody>{items.map((item) => <tr key={`${item.source}-${item.id}`} className={selected?.id === item.id ? "selected-availability-row" : ""}><td><a href={item.url} target="_blank" rel="noreferrer">{item.name}</a><small>Ref. {item.externalId}{item.category ? ` · ${item.category}` : ""}</small></td><td><span className={`availability-source ${item.source}`}>{item.sourceName}</span></td><td>{quantity(item.firstQuantity, item.firstAvailable)}<small>{formatDay(item.firstDate)}</small></td><td>{quantity(item.latestQuantity, item.latestAvailable)}<small>{formatDay(item.latestDate)}</small></td><td>{item.minimumQuantity == null ? "—" : integer.format(item.minimumQuantity)}</td><td>{item.maximumQuantity == null ? "—" : integer.format(item.maximumQuantity)}</td><td className={item.quantityDifference == null ? "neutral" : item.quantityDifference > 0 ? "availability-positive" : item.quantityDifference < 0 ? "availability-negative" : "neutral"}><strong>{item.quantityDifference == null ? "—" : `${item.quantityDifference > 0 ? "+" : ""}${integer.format(item.quantityDifference)}`}</strong><small>{integer.format(item.captureDays)} días con captura</small></td><td><span className={`availability-movement ${item.movement}`}>{movementLabels[item.movement]}</span></td><td><button className="availability-detail-button" aria-haspopup="dialog" aria-expanded={selected?.id === item.id} onClick={(event) => openDetail(item, event.currentTarget)}>Ver evolución</button></td></tr>)}</tbody></table></div>}
      <div className="changes-load-more">{page?.hasMore ? <button onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "Cargando…" : "Cargar 50 productos más"}</button> : items.length ? <span>Se mostraron todos los productos con estos filtros</span> : null}</div>
    </article>

    {selected && <div className="availability-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetail(); }}>
      <aside ref={drawerRef} className="availability-product-drawer" role="dialog" aria-modal="true" aria-labelledby="availability-detail-title">
        <div className="availability-product-detail-head"><div><span className={`availability-source ${selected.source}`}>{selected.sourceName}</span><h2 id="availability-detail-title">{selected.name}</h2><small>Ref. {selected.externalId}{selected.category ? ` · ${selected.category}` : ""}</small></div><button ref={closeButtonRef} onClick={closeDetail} aria-label="Cerrar evolución del producto">×</button></div>
        <div className="availability-drawer-body">
          <div className="availability-detail-actions"><span>Evolución dentro del periodo seleccionado</span><a href={selected.url} target="_blank" rel="noreferrer">Abrir producto en {selected.sourceName} ↗</a></div>
          <div className="availability-detail-metrics"><div><span>Unidades iniciales</span><strong>{quantity(selected.firstQuantity, selected.firstAvailable)}</strong></div><div><span>Unidades actuales</span><strong>{quantity(selected.latestQuantity, selected.latestAvailable)}</strong></div><div><span>Variación neta</span><strong className={selected.quantityDifference == null ? "neutral" : selected.quantityDifference > 0 ? "availability-positive" : selected.quantityDifference < 0 ? "availability-negative" : "neutral"}>{selected.quantityDifference == null ? "—" : `${selected.quantityDifference > 0 ? "+" : ""}${integer.format(selected.quantityDifference)}`}</strong></div><div><span>Mínimo reportado</span><strong>{selected.minimumQuantity == null ? "—" : integer.format(selected.minimumQuantity)}</strong></div><div><span>Máximo reportado</span><strong>{selected.maximumQuantity == null ? "—" : integer.format(selected.maximumQuantity)}</strong></div><div><span>Días con captura</span><strong>{integer.format(selected.captureDays)}</strong></div></div>
          {productLoading ? <div className="availability-detail-skeleton" aria-label="Cargando histórico"><span/><span/><span/></div> : !productHistory?.points.length ? <div className="empty-state">Este producto no tiene capturas de disponibilidad dentro del periodo seleccionado.</div> : <>
            {detailChart.path && <div className="availability-detail-chart-wrap"><h3>Evolución de unidades</h3><svg className="availability-product-chart" viewBox="0 0 760 225" role="img" aria-label="Evolución de unidades del producto"><line className="chart-grid" x1="45" x2="735" y1="45" y2="45"/><line className="chart-grid" x1="45" x2="735" y1="115" y2="115"/><line className="chart-grid" x1="45" x2="735" y1="190" y2="190"/><path d={detailChart.path} fill="none" stroke={SOURCE_COLORS[selected.source]} strokeWidth="3"/>{detailChart.dots.map((dot) => <circle key={dot.point.date} cx={dot.x} cy={dot.y} r="4" fill="#fff" stroke={SOURCE_COLORS[selected.source]} strokeWidth="3"><title>{`${formatDay(dot.point.date)} · ${integer.format(dot.point.quantity)} unidades`}</title></circle>)}</svg></div>}
            <div className="availability-captures-head"><h3>Capturas del periodo</h3><small>{integer.format(productHistory.points.length)} registros</small></div><div className="table-scroll"><table className="availability-product-history-table"><thead><tr><th>Fecha</th><th>Unidades reportadas</th><th>Variación</th><th>Estado</th></tr></thead><tbody>{[...productHistory.points].reverse().map((point) => <tr key={point.date}><td>{formatDay(point.date)}</td><td>{point.quantity == null ? "Sin cantidad" : integer.format(point.quantity)}</td><td className={point.difference == null ? "neutral" : point.difference > 0 ? "availability-positive" : point.difference < 0 ? "availability-negative" : "neutral"}>{point.difference == null ? "—" : `${point.difference > 0 ? "+" : ""}${integer.format(point.difference)}`}</td><td>{point.available === true ? "Disponible" : point.available === false ? "Sin stock" : "No determinado"}</td></tr>)}</tbody></table></div>
          </>}
        </div>
      </aside>
    </div>}
  </section>;
}
