"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CompetitorSource = "damasco" | "multimax" | "ivoo" | "venelectronics";
type Product = { id: number; externalId: string; name: string; category?: string | null; url: string; price: number; inStock: boolean | null };
type HistoryItem = {
  matchId: number; daka: Product; competitor: Product; captureDays: number;
  dakaLowerDays: number; competitorLowerDays: number; equalDays: number; leadershipChanges: number;
  firstDate: string; latestDate: string; firstDakaPrice: number; firstCompetitorPrice: number;
  latestGapUsd: number; firstGapPct: number; latestGapPct: number; gapChangePct: number;
  averageAbsGapPct: number; bestDakaGapPct: number; worstDakaGapPct: number;
  movement: "gained" | "lost" | "stable";
};
type Stats = { total: number; dakaLower: number; competitorLower: number; gained: number; lost: number; switched: number; averageGapPct: number };
type PeriodInfo = { mode: "preset" | "custom"; days: number; startDate: string; endDate: string; totalDays: number };
type Page = { items: HistoryItem[]; total: number; hasMore: boolean; categories: string[]; stats: Stats; period: PeriodInfo; error?: string };
type Point = { date: string; dakaPrice: number; competitorPrice: number; gapUsd: number; gapPct: number; dakaInStock: boolean | null; competitorInStock: boolean | null };
type Detail = { dakaName: string; dakaSap: string; competitorName: string; competitorReference: string; points: Point[]; error?: string };

const money = new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD" });
const integer = new Intl.NumberFormat("es-VE");
const EMPTY_STATS: Stats = { total: 0, dakaLower: 0, competitorLower: 0, gained: 0, lost: 0, switched: 0, averageGapPct: 0 };
const BATCH_SIZE = 50;

function isoDateInCaracas(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Caracas", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function shiftIsoDate(value: string, amount: number) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

function defaultCustomRange() {
  const endDate = isoDateInCaracas();
  return { startDate: shiftIsoDate(endDate, -29), endDate };
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat("es-VE", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

function movementLabel(value: HistoryItem["movement"]) {
  if (value === "gained") return "DAKA ganó competitividad";
  if (value === "lost") return "DAKA perdió competitividad";
  return "Posición estable";
}

function gapDescription(gap: number) {
  if (Math.abs(gap) <= 0.01) return "mismo precio";
  return `DAKA ${Math.abs(gap).toFixed(1)}% más ${gap < 0 ? "económico" : "caro"}`;
}

function evolutionSummary(item: HistoryItem, competitorName: string) {
  if (item.captureDays < 2) return { className: "stable", icon: "•", title: "Historial insuficiente", detail: "Se necesitan al menos 2 días comparables", change: "Todavía no es posible medir la evolución" };
  const points = Math.abs(item.gapChangePct).toFixed(1);
  const changedLeader = (item.firstGapPct <= 0 && item.latestGapPct > 0) || (item.firstGapPct >= 0 && item.latestGapPct < 0);
  if (item.movement === "gained") {
    const title = changedLeader ? "DAKA tomó la ventaja" : `DAKA mejoró ${points} pp`;
    return { className: "gained", icon: "↑", title, detail: `Antes: ${gapDescription(item.firstGapPct)} · Ahora: ${gapDescription(item.latestGapPct)}`, change: changedLeader ? `Mejora de ${points} puntos porcentuales` : `La brecha mejoró ${points} puntos porcentuales` };
  }
  if (item.movement === "lost") {
    const title = changedLeader ? "DAKA perdió la ventaja" : `DAKA perdió competitividad ${points} pp`;
    return { className: "lost", icon: "↓", title, detail: `Antes: ${gapDescription(item.firstGapPct)} · Ahora: ${gapDescription(item.latestGapPct)}`, change: changedLeader ? `${competitorName} tomó la ventaja` : `La brecha empeoró ${points} puntos porcentuales` };
  }
  return { className: "stable", icon: "↔", title: "Sin cambio relevante", detail: `Antes: ${gapDescription(item.firstGapPct)} · Ahora: ${gapDescription(item.latestGapPct)}`, change: "Variación menor a 0,1 puntos porcentuales" };
}

function advantageSummary(item: HistoryItem, competitorName: string) {
  const total = Math.max(item.captureDays, 1);
  const dakaPct = (item.dakaLowerDays / total) * 100;
  const competitorPct = (item.competitorLowerDays / total) * 100;
  const equalPct = (item.equalDays / total) * 100;
  if (item.dakaLowerDays > item.competitorLowerDays) return { title: "DAKA tuvo ventaja", days: item.dakaLowerDays, percentage: dakaPct, dakaPct, competitorPct, equalPct };
  if (item.competitorLowerDays > item.dakaLowerDays) return { title: `${competitorName} tuvo ventaja`, days: item.competitorLowerDays, percentage: competitorPct, dakaPct, competitorPct, equalPct };
  if (item.equalDays === item.captureDays) return { title: "Mismo precio en el período", days: item.equalDays, percentage: equalPct, dakaPct, competitorPct, equalPct };
  return { title: "Ventaja equilibrada", days: item.dakaLowerDays, percentage: dakaPct, dakaPct, competitorPct, equalPct };
}

function currentGapText(item: HistoryItem) {
  if (Math.abs(item.latestGapUsd) < 0.01) return "Mismo precio en ambas tiendas";
  return `DAKA está ${money.format(Math.abs(item.latestGapUsd))} más ${item.latestGapUsd < 0 ? "económico" : "caro"}`;
}

function csvCell(value: string | number) {
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function buildChart(points: Point[]) {
  if (!points.length) return { daka: "", competitor: "", coordinates: [] as Array<{ x: number; dakaY: number; competitorY: number }> };
  const values = points.flatMap((point) => [point.dakaPrice, point.competitorPrice]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const coordinates = points.map((point, index) => ({
    x: 45 + (index / Math.max(points.length - 1, 1)) * 650,
    dakaY: 190 - ((point.dakaPrice - min) / range) * 145,
    competitorY: 190 - ((point.competitorPrice - min) / range) * 145
  }));
  const path = (key: "dakaY" | "competitorY") => coordinates.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point[key].toFixed(1)}`).join(" ");
  return { daka: path("dakaY"), competitor: path("competitorY"), coordinates };
}

export default function CompetitorHistory({ source, competitorName }: { source: CompetitorSource; competitorName: string }) {
  const [days, setDays] = useState("30");
  const [customRange, setCustomRange] = useState(defaultCustomRange);
  const [appliedCustomRange, setAppliedCustomRange] = useState(defaultCustomRange);
  const [dateError, setDateError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState("");
  const [position, setPosition] = useState("all");
  const [movement, setMovement] = useState("all");
  const [availability, setAvailability] = useState("both");
  const [minGap, setMinGap] = useState("0");
  const [sort, setSort] = useState("opportunity");
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [period, setPeriod] = useState<PeriodInfo>(() => ({ mode: "preset", days: 30, startDate: defaultCustomRange().startDate, endDate: defaultCustomRange().endDate, totalDays: 30 }));
  const [selected, setSelected] = useState<HistoryItem | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryVersion = useRef(0);

  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 400); return () => window.clearTimeout(timer); }, [search]);
  const parameters = useCallback((offset: number) => {
    const result = new URLSearchParams({ source, days, search: debouncedSearch, category, position, movement, availability, minGap, sort, limit: String(BATCH_SIZE), offset: String(offset) });
    if (days === "custom") {
      result.set("startDate", appliedCustomRange.startDate);
      result.set("endDate", appliedCustomRange.endDate);
    }
    return result;
  }, [appliedCustomRange, availability, category, days, debouncedSearch, minGap, movement, position, sort, source]);

  useEffect(() => {
    const controller = new AbortController();
    const version = ++queryVersion.current;
    setLoading(true); setError(null); setItems([]); setSelected(null); setDetail(null);
    fetch(`/api/comparison-history?${parameters(0)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const payload = await response.json() as Page; if (!response.ok) throw new Error(payload.error); return payload; })
      .then((page) => { if (version !== queryVersion.current) return; setItems(page.items); setSelected(page.items[0] ?? null); setTotal(page.total); setHasMore(page.hasMore); setCategories(page.categories); setStats(page.stats); setPeriod(page.period); })
      .catch((requestError) => { if (!(requestError instanceof DOMException && requestError.name === "AbortError") && version === queryVersion.current) setError(requestError instanceof Error ? requestError.message : "No fue posible cargar el histórico"); })
      .finally(() => { if (version === queryVersion.current) setLoading(false); });
    return () => controller.abort();
  }, [parameters]);

  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    const controller = new AbortController();
    setDetailLoading(true);
    const detailParameters = new URLSearchParams({ source, days });
    if (days === "custom") { detailParameters.set("startDate", appliedCustomRange.startDate); detailParameters.set("endDate", appliedCustomRange.endDate); }
    fetch(`/api/comparison-history/${selected.matchId}?${detailParameters}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const payload = await response.json() as Detail; if (!response.ok) throw new Error(payload.error); return payload; })
      .then(setDetail).catch((requestError) => { if (!(requestError instanceof DOMException && requestError.name === "AbortError")) setError(requestError instanceof Error ? requestError.message : "No fue posible cargar el detalle"); })
      .finally(() => setDetailLoading(false));
    return () => controller.abort();
  }, [appliedCustomRange, days, selected, source]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(`/api/comparison-history?${parameters(items.length)}`, { cache: "no-store" });
      const page = await response.json() as Page;
      if (!response.ok) throw new Error(page.error);
      setItems((current) => [...current, ...page.items.filter((item) => !current.some((known) => known.matchId === item.matchId))]);
      setTotal(page.total); setHasMore(page.hasMore); setStats(page.stats); setPeriod(page.period);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "No fue posible cargar más resultados"); }
    finally { setLoadingMore(false); }
  }, [hasMore, items.length, loadingMore, parameters]);

  const chart = useMemo(() => buildChart(detail?.points ?? []), [detail]);
  const leadershipRate = stats.total ? (stats.dakaLower / stats.total) * 100 : 0;

  function applyCustomDates() {
    if (!customRange.startDate || !customRange.endDate) { setDateError("Selecciona las fechas Desde y Hasta"); return; }
    if (customRange.startDate > customRange.endDate) { setDateError("La fecha Desde no puede ser posterior a la fecha Hasta"); return; }
    const rangeDays = Math.floor((Date.parse(`${customRange.endDate}T00:00:00Z`) - Date.parse(`${customRange.startDate}T00:00:00Z`)) / 86_400_000) + 1;
    if (rangeDays > 365) { setDateError("El rango personalizado no puede superar 365 días"); return; }
    setDateError(null);
    setAppliedCustomRange(customRange);
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const exportParameters = parameters(0);
      exportParameters.set("export", "1");
      const response = await fetch(`/api/comparison-history?${exportParameters}`, { cache: "no-store" });
      const page = await response.json() as Page;
      if (!response.ok) throw new Error(page.error);
      const headers = ["Desde", "Hasta", "SAP DAKA", "Producto DAKA", "Categoría", "Competidor", "Referencia competidor", "Precio DAKA", `Precio ${competitorName}`, "Brecha USD actual", "Brecha % inicial", "Brecha % actual", "Cambio en puntos porcentuales", "Evolución competitiva", "Días del período", "Días comparables", "Días ventaja DAKA", `Días ventaja ${competitorName}`, "Días mismo precio", "Cambios de liderazgo"];
      const lines = [headers.map(csvCell).join(","), ...page.items.map((item) => [page.period.startDate, page.period.endDate, item.daka.externalId, item.daka.name, item.daka.category ?? "", competitorName, item.competitor.externalId, item.daka.price.toFixed(2), item.competitor.price.toFixed(2), item.latestGapUsd.toFixed(2), item.firstGapPct.toFixed(2), item.latestGapPct.toFixed(2), item.gapChangePct.toFixed(2), evolutionSummary(item, competitorName).title, page.period.totalDays, item.captureDays, item.dakaLowerDays, item.competitorLowerDays, item.equalDays, item.leadershipChanges].map(csvCell).join(","))];
      const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const periodName = days === "custom" ? `${period.startDate}-a-${period.endDate}` : `${days}-dias`;
      anchor.href = url; anchor.download = `historico-competitivo-${source}-${periodName}.csv`; anchor.click();
      URL.revokeObjectURL(url);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "No fue posible exportar el análisis"); }
    finally { setExporting(false); }
  }

  return <div className={`competitor-history source-${source}`}>
    <section className="history-intro"><div><span className="eyebrow-dark">Evolución competitiva</span><h2>Histórico DAKA frente a {competitorName}</h2><p>Capturas exitosas emparejadas por día en hora de Venezuela. Los días sin información de alguna fuente no se sustituyen con datos antiguos.</p></div><div className="history-intro-actions"><div className="leadership-index"><span>Liderazgo DAKA</span><strong>{leadershipRate.toFixed(1)}%</strong><small>de los productos filtrados</small></div><button className="secondary-button" onClick={() => void exportCsv()} disabled={exporting || loading}>{exporting ? "Exportando…" : "Exportar análisis CSV"}</button></div></section>
    <section className="comparison-stats history-stats"><article className="daka-win"><span>DAKA con mejor precio</span><strong>{loading ? "…" : integer.format(stats.dakaLower)}</strong><small>Posición más reciente</small></article><article className="competitor-win"><span>{competitorName} con mejor precio</span><strong>{loading ? "…" : integer.format(stats.competitorLower)}</strong><small>Oportunidades por revisar</small></article><article><span>DAKA ganó competitividad</span><strong>{loading ? "…" : integer.format(stats.gained)}</strong><small>Brecha mejoró en el período</small></article><article><span>DAKA perdió competitividad</span><strong>{loading ? "…" : integer.format(stats.lost)}</strong><small>Brecha se deterioró</small></article><article><span>Cambios de liderazgo</span><strong>{loading ? "…" : integer.format(stats.switched)}</strong><small>Al menos un cambio</small></article></section>
    <section className="filters history-filters">
      <select value={days} onChange={(event) => { setDays(event.target.value); setDateError(null); }}><option value="7">Últimos 7 días</option><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option><option value="custom">Rango personalizado</option></select>
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Producto, SAP, marca o referencia"/>
      <select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Todas las categorías</option>{categories.map((value) => <option key={value}>{value}</option>)}</select>
      <select value={position} onChange={(event) => setPosition(event.target.value)}><option value="all">Todas las posiciones</option><option value="daka_lower">DAKA más económico</option><option value="competitor_lower">Competidor más económico</option><option value="equal">Mismo precio</option></select>
      <select value={movement} onChange={(event) => setMovement(event.target.value)}><option value="all">Todos los movimientos</option><option value="gained">DAKA ganó competitividad</option><option value="lost">DAKA perdió competitividad</option><option value="switched">Cambió el liderazgo</option><option value="stable">Sin cambio relevante</option></select>
      <select value={minGap} onChange={(event) => setMinGap(event.target.value)}><option value="0">Cualquier brecha</option><option value="5">Brecha ≥ 5%</option><option value="10">Brecha ≥ 10%</option><option value="20">Brecha ≥ 20%</option></select>
      <select value={availability} onChange={(event) => setAvailability(event.target.value)}><option value="both">Disponibles en ambas</option><option value="competitor">Competidor disponible</option><option value="all">Cualquier disponibilidad</option></select>
      <select value={sort} onChange={(event) => setSort(event.target.value)}><option value="opportunity">Mayor oportunidad</option><option value="deteriorated">Mayor deterioro DAKA</option><option value="improved">Mayor mejora DAKA</option><option value="sustained">Desventaja más sostenida</option><option value="favorable">Mayor ventaja DAKA</option></select>
      {days === "custom" && <div className="custom-date-filter"><div><label htmlFor={`history-start-${source}`}>Desde</label><input id={`history-start-${source}`} type="date" value={customRange.startDate} max={customRange.endDate} onChange={(event) => setCustomRange((current) => ({ ...current, startDate: event.target.value }))}/></div><div><label htmlFor={`history-end-${source}`}>Hasta</label><input id={`history-end-${source}`} type="date" value={customRange.endDate} min={customRange.startDate} max={isoDateInCaracas()} onChange={(event) => setCustomRange((current) => ({ ...current, endDate: event.target.value }))}/></div><button type="button" onClick={applyCustomDates} disabled={customRange.startDate === appliedCustomRange.startDate && customRange.endDate === appliedCustomRange.endDate}>Aplicar fechas</button><small>Máximo 365 días · horario de Venezuela</small>{dateError && <span>{dateError}</span>}</div>}
    </section>
    {error && <div className="error-banner"><strong>Histórico competitivo pendiente</strong><span>{error}</span></div>}
    <section className="history-grid"><article className="comparison-table-card"><div className="section-head"><h2>Evolución por producto</h2><small>{loading ? "Analizando…" : `Mostrando ${integer.format(items.length)} de ${integer.format(total)}`}</small></div>{loading ? <div className="empty-state">Emparejando capturas y calculando posiciones…</div> : items.length === 0 ? <div className="empty-state">No existen comparaciones históricas con estos filtros.</div> : <div className="table-scroll"><table className="comparison-table competitive-history-table"><thead><tr><th>Producto</th><th>Precios actuales</th><th>Brecha actual</th><th>Evolución competitiva</th><th>Ventaja en el período</th></tr></thead><tbody>{items.map((item) => {
        const evolution = evolutionSummary(item, competitorName);
        const advantage = advantageSummary(item, competitorName);
        const leadershipText = item.leadershipChanges === 0 ? "Sin cambios de liderazgo" : `${item.leadershipChanges} ${item.leadershipChanges === 1 ? "cambio" : "cambios"} de liderazgo`;
        return <tr key={item.matchId} className={selected?.matchId === item.matchId ? "selected-comparison" : ""} onClick={() => setSelected(item)}>
          <td className="compared-products-cell"><div className="compared-product daka-product"><div className="compared-product-head"><span className="store-identity daka-identity">DAKA</span><a href={item.daka.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>Abrir ficha ↗</a></div><b>{item.daka.name}</b><small>SAP {item.daka.externalId} · {item.daka.category ?? "Sin categoría"}</small></div><div className="match-divider"><span>Homologado con</span></div><div className="compared-product competitor-product"><div className="compared-product-head"><span className="store-identity competitor-identity">{competitorName}</span><a href={item.competitor.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>Abrir ficha ↗</a></div><b>{item.competitor.name}</b><small>Referencia {item.competitor.externalId}</small></div></td>
          <td className="current-prices-cell"><div className="store-price daka-current-price"><span>DAKA</span><b>{money.format(item.daka.price)}</b>{item.daka.price < item.competitor.price && <em>Mejor precio</em>}{item.daka.price === item.competitor.price && <em>Mismo precio</em>}</div><div className="store-price competitor-current-price"><span>{competitorName}</span><b>{money.format(item.competitor.price)}</b>{item.competitor.price < item.daka.price && <em>Mejor precio</em>}{item.daka.price === item.competitor.price && <em>Mismo precio</em>}</div></td>
          <td className={item.latestGapPct <= 0 ? "comparison-favorable gap-current-cell" : "comparison-unfavorable gap-current-cell"}><b>{item.latestGapPct > 0 ? "+" : ""}{item.latestGapPct.toFixed(1)}%</b><small>{currentGapText(item)}</small></td>
          <td className="evolution-cell"><span className={`movement-badge ${evolution.className}`}><i aria-hidden="true">{evolution.icon}</i>{evolution.title}</span><small>{evolution.detail}</small><small>{evolution.change} · {leadershipText}</small></td>
          <td className="advantage-cell"><b>{advantage.title}</b><strong>{advantage.days} de {item.captureDays} días · {advantage.percentage.toFixed(0)}%</strong><div className="advantage-bar" role="img" aria-label={`DAKA ${item.dakaLowerDays} días, ${competitorName} ${item.competitorLowerDays} días, mismo precio ${item.equalDays} días`}><span className="daka-advantage" style={{ width: `${advantage.dakaPct}%` }}/><span className="competitor-advantage" style={{ width: `${advantage.competitorPct}%` }}/><span className="equal-advantage" style={{ width: `${advantage.equalPct}%` }}/></div><small>DAKA: {item.dakaLowerDays} · {competitorName}: {item.competitorLowerDays} · Empates: {item.equalDays}</small><small className="coverage-line">Cobertura: {item.captureDays} de {period.totalDays} días del período</small></td>
        </tr>;
      })}</tbody></table></div>}{items.length > 0 && <div className="changes-load-more">{hasMore ? <button onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "Cargando…" : "Cargar 50 comparaciones más"}</button> : <span>Se mostraron todas las comparaciones</span>}</div>}</article>
      <article className="history-detail-card">{detailLoading ? <div className="empty-state">Cargando evolución del producto…</div> : selected && detail ? <><div className="history-detail-head"><span className="eyebrow-dark">Serie competitiva</span><h2>{detail.dakaName}</h2><p>SAP {detail.dakaSap} · {detail.points.length} de {period.totalDays} días comparables</p></div><div className="chart-legend"><span className="daka-line">DAKA</span><span className="competitor-line">{competitorName}</span></div><svg className="competitive-history-chart" viewBox="0 0 740 230" role="img" aria-label={`Histórico de precios DAKA y ${competitorName}`}><line x1="45" y1="45" x2="695" y2="45"/><line x1="45" y1="115" x2="695" y2="115"/><line x1="45" y1="190" x2="695" y2="190"/><path className="daka-price-line" d={chart.daka}/><path className="competitor-price-line" d={chart.competitor}/>{chart.coordinates.map((point, index) => <g key={index}><circle className="daka-price-dot" cx={point.x} cy={point.dakaY} r="3"/><circle className="competitor-price-dot" cx={point.x} cy={point.competitorY} r="3"/></g>)}</svg><div className="history-detail-metrics"><div><span>Inicio del período</span><b>{selected.firstGapPct > 0 ? "+" : ""}{selected.firstGapPct.toFixed(1)}%</b></div><div><span>Brecha más reciente</span><b>{selected.latestGapPct > 0 ? "+" : ""}{selected.latestGapPct.toFixed(1)}%</b></div><div><span>Mejor posición DAKA</span><b>{selected.bestDakaGapPct.toFixed(1)}%</b></div><div><span>Peor posición DAKA</span><b>{selected.worstDakaGapPct > 0 ? "+" : ""}{selected.worstDakaGapPct.toFixed(1)}%</b></div></div><div className={`competitive-conclusion ${selected.latestGapPct <= 0 ? "favorable" : "unfavorable"}`}><span>Conclusión del período</span><strong>{evolutionSummary(selected, competitorName).title}</strong><p>{evolutionSummary(selected, competitorName).detail}. {advantageSummary(selected, competitorName).title} {advantageSummary(selected, competitorName).days} de {selected.captureDays} días comparables.</p></div><div className="point-history"><h3>Últimos movimientos comparables</h3>{[...detail.points].reverse().slice(0, 10).map((point) => <div key={point.date}><span>{formatDay(point.date)}</span><b>{money.format(point.dakaPrice)} / {money.format(point.competitorPrice)}</b><em className={point.gapPct <= 0 ? "comparison-favorable" : "comparison-unfavorable"}>{point.gapPct > 0 ? "+" : ""}{point.gapPct.toFixed(1)}%</em></div>)}</div></> : <div className="empty-state detail-empty">Selecciona un producto para analizar su evolución competitiva.</div>}</article>
    </section>
  </div>;
}
