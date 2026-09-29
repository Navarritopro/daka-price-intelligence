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
type Page = { items: HistoryItem[]; total: number; hasMore: boolean; categories: string[]; stats: Stats; error?: string };
type Point = { date: string; dakaPrice: number; competitorPrice: number; gapUsd: number; gapPct: number; dakaInStock: boolean | null; competitorInStock: boolean | null };
type Detail = { dakaName: string; dakaSap: string; competitorName: string; competitorReference: string; points: Point[]; error?: string };

const money = new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD" });
const integer = new Intl.NumberFormat("es-VE");
const EMPTY_STATS: Stats = { total: 0, dakaLower: 0, competitorLower: 0, gained: 0, lost: 0, switched: 0, averageGapPct: 0 };
const BATCH_SIZE = 50;

function formatDay(value: string) {
  return new Intl.DateTimeFormat("es-VE", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

function movementLabel(value: HistoryItem["movement"]) {
  if (value === "gained") return "DAKA ganó competitividad";
  if (value === "lost") return "DAKA perdió competitividad";
  return "Posición estable";
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
  const parameters = useCallback((offset: number) => new URLSearchParams({ source, days, search: debouncedSearch, category, position, movement, availability, minGap, sort, limit: String(BATCH_SIZE), offset: String(offset) }), [availability, category, days, debouncedSearch, minGap, movement, position, sort, source]);

  useEffect(() => {
    const controller = new AbortController();
    const version = ++queryVersion.current;
    setLoading(true); setError(null); setItems([]); setSelected(null); setDetail(null);
    fetch(`/api/comparison-history?${parameters(0)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const payload = await response.json() as Page; if (!response.ok) throw new Error(payload.error); return payload; })
      .then((page) => { if (version !== queryVersion.current) return; setItems(page.items); setSelected(page.items[0] ?? null); setTotal(page.total); setHasMore(page.hasMore); setCategories(page.categories); setStats(page.stats); })
      .catch((requestError) => { if (!(requestError instanceof DOMException && requestError.name === "AbortError") && version === queryVersion.current) setError(requestError instanceof Error ? requestError.message : "No fue posible cargar el histórico"); })
      .finally(() => { if (version === queryVersion.current) setLoading(false); });
    return () => controller.abort();
  }, [parameters]);

  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    const controller = new AbortController();
    setDetailLoading(true);
    fetch(`/api/comparison-history/${selected.matchId}?source=${source}&days=${days}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const payload = await response.json() as Detail; if (!response.ok) throw new Error(payload.error); return payload; })
      .then(setDetail).catch((requestError) => { if (!(requestError instanceof DOMException && requestError.name === "AbortError")) setError(requestError instanceof Error ? requestError.message : "No fue posible cargar el detalle"); })
      .finally(() => setDetailLoading(false));
    return () => controller.abort();
  }, [days, selected, source]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(`/api/comparison-history?${parameters(items.length)}`, { cache: "no-store" });
      const page = await response.json() as Page;
      if (!response.ok) throw new Error(page.error);
      setItems((current) => [...current, ...page.items.filter((item) => !current.some((known) => known.matchId === item.matchId))]);
      setTotal(page.total); setHasMore(page.hasMore); setStats(page.stats);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "No fue posible cargar más resultados"); }
    finally { setLoadingMore(false); }
  }, [hasMore, items.length, loadingMore, parameters]);

  const chart = useMemo(() => buildChart(detail?.points ?? []), [detail]);
  const leadershipRate = stats.total ? (stats.dakaLower / stats.total) * 100 : 0;

  async function exportCsv() {
    setExporting(true);
    try {
      const exportParameters = parameters(0);
      exportParameters.set("export", "1");
      const response = await fetch(`/api/comparison-history?${exportParameters}`, { cache: "no-store" });
      const page = await response.json() as Page;
      if (!response.ok) throw new Error(page.error);
      const headers = ["SAP DAKA", "Producto DAKA", "Categoría", "Competidor", "Referencia competidor", "Precio DAKA", `Precio ${competitorName}`, "Brecha USD", "Brecha %", "Movimiento", "Días comparables", "Días ventaja DAKA", `Días ventaja ${competitorName}`, "Cambios de liderazgo"];
      const lines = [headers.map(csvCell).join(","), ...page.items.map((item) => [item.daka.externalId, item.daka.name, item.daka.category ?? "", competitorName, item.competitor.externalId, item.daka.price.toFixed(2), item.competitor.price.toFixed(2), item.latestGapUsd.toFixed(2), item.latestGapPct.toFixed(2), movementLabel(item.movement), item.captureDays, item.dakaLowerDays, item.competitorLowerDays, item.leadershipChanges].map(csvCell).join(","))];
      const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `historico-competitivo-${source}-${days}-dias.csv`; anchor.click();
      URL.revokeObjectURL(url);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "No fue posible exportar el análisis"); }
    finally { setExporting(false); }
  }

  return <>
    <section className="history-intro"><div><span className="eyebrow-dark">Evolución competitiva</span><h2>Histórico DAKA frente a {competitorName}</h2><p>Capturas exitosas emparejadas por día en hora de Venezuela. Los días sin información de alguna fuente no se sustituyen con datos antiguos.</p></div><div className="history-intro-actions"><div className="leadership-index"><span>Liderazgo DAKA</span><strong>{leadershipRate.toFixed(1)}%</strong><small>de los productos filtrados</small></div><button className="secondary-button" onClick={() => void exportCsv()} disabled={exporting || loading}>{exporting ? "Exportando…" : "Exportar análisis CSV"}</button></div></section>
    <section className="comparison-stats history-stats"><article className="daka-win"><span>DAKA con mejor precio</span><strong>{loading ? "…" : integer.format(stats.dakaLower)}</strong><small>Posición más reciente</small></article><article className="competitor-win"><span>{competitorName} con mejor precio</span><strong>{loading ? "…" : integer.format(stats.competitorLower)}</strong><small>Oportunidades por revisar</small></article><article><span>DAKA ganó competitividad</span><strong>{loading ? "…" : integer.format(stats.gained)}</strong><small>Brecha mejoró en el período</small></article><article><span>DAKA perdió competitividad</span><strong>{loading ? "…" : integer.format(stats.lost)}</strong><small>Brecha se deterioró</small></article><article><span>Cambios de liderazgo</span><strong>{loading ? "…" : integer.format(stats.switched)}</strong><small>Al menos un cambio</small></article></section>
    <section className="filters history-filters"><select value={days} onChange={(event) => setDays(event.target.value)}><option value="7">Últimos 7 días</option><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option></select><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Producto, SAP, marca o referencia"/><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Todas las categorías</option>{categories.map((value) => <option key={value}>{value}</option>)}</select><select value={position} onChange={(event) => setPosition(event.target.value)}><option value="all">Todas las posiciones</option><option value="daka_lower">DAKA más económico</option><option value="competitor_lower">Competidor más económico</option><option value="equal">Mismo precio</option></select><select value={movement} onChange={(event) => setMovement(event.target.value)}><option value="all">Todos los movimientos</option><option value="gained">DAKA ganó competitividad</option><option value="lost">DAKA perdió competitividad</option><option value="switched">Cambió el liderazgo</option><option value="stable">Posición estable</option></select><select value={minGap} onChange={(event) => setMinGap(event.target.value)}><option value="0">Cualquier brecha</option><option value="5">Brecha ≥ 5%</option><option value="10">Brecha ≥ 10%</option><option value="20">Brecha ≥ 20%</option></select><select value={availability} onChange={(event) => setAvailability(event.target.value)}><option value="both">Disponibles en ambas</option><option value="competitor">Competidor disponible</option><option value="all">Cualquier disponibilidad</option></select><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="opportunity">Mayor oportunidad</option><option value="deteriorated">Mayor deterioro DAKA</option><option value="improved">Mayor mejora DAKA</option><option value="sustained">Desventaja más sostenida</option><option value="favorable">Mayor ventaja DAKA</option></select></section>
    {error && <div className="error-banner"><strong>Histórico competitivo pendiente</strong><span>{error}</span></div>}
    <section className="history-grid"><article className="comparison-table-card"><div className="section-head"><h2>Evolución por producto</h2><small>{loading ? "Analizando…" : `Mostrando ${integer.format(items.length)} de ${integer.format(total)}`}</small></div>{loading ? <div className="empty-state">Emparejando capturas y calculando posiciones…</div> : items.length === 0 ? <div className="empty-state">No existen comparaciones históricas con estos filtros.</div> : <div className="table-scroll"><table className="comparison-table history-table"><thead><tr><th>Producto</th><th>Precios actuales</th><th>Brecha actual</th><th>Evolución</th><th>Días con ventaja</th></tr></thead><tbody>{items.map((item) => <tr key={item.matchId} className={selected?.matchId === item.matchId ? "selected-comparison" : ""} onClick={() => setSelected(item)}><td><b>{item.daka.name}</b><small>SAP {item.daka.externalId} · {item.daka.category ?? "Sin categoría"}</small></td><td><b>{money.format(item.daka.price)} / {money.format(item.competitor.price)}</b><small>DAKA / {competitorName}</small></td><td className={item.latestGapPct <= 0 ? "comparison-favorable" : "comparison-unfavorable"}><b>{item.latestGapPct > 0 ? "+" : ""}{item.latestGapPct.toFixed(1)}%</b><small>{item.latestGapUsd > 0 ? "+" : ""}{money.format(item.latestGapUsd)}</small></td><td><span className={`movement-badge ${item.movement}`}>{movementLabel(item.movement)}</span><small>{item.leadershipChanges} cambios de liderazgo</small></td><td><b>{item.dakaLowerDays} DAKA / {item.competitorLowerDays} {competitorName}</b><small>{item.captureDays} días comparables</small></td></tr>)}</tbody></table></div>}{items.length > 0 && <div className="changes-load-more">{hasMore ? <button onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "Cargando…" : "Cargar 50 comparaciones más"}</button> : <span>Se mostraron todas las comparaciones</span>}</div>}</article>
      <article className="history-detail-card">{detailLoading ? <div className="empty-state">Cargando evolución del producto…</div> : selected && detail ? <><div className="history-detail-head"><span className="eyebrow-dark">Serie competitiva</span><h2>{detail.dakaName}</h2><p>SAP {detail.dakaSap} · {detail.points.length} días comparables</p></div><div className="chart-legend"><span className="daka-line">DAKA</span><span className="competitor-line">{competitorName}</span></div><svg className="competitive-history-chart" viewBox="0 0 740 230" role="img" aria-label={`Histórico de precios DAKA y ${competitorName}`}><line x1="45" y1="45" x2="695" y2="45"/><line x1="45" y1="115" x2="695" y2="115"/><line x1="45" y1="190" x2="695" y2="190"/><path className="daka-price-line" d={chart.daka}/><path className="competitor-price-line" d={chart.competitor}/>{chart.coordinates.map((point, index) => <g key={index}><circle className="daka-price-dot" cx={point.x} cy={point.dakaY} r="3"/><circle className="competitor-price-dot" cx={point.x} cy={point.competitorY} r="3"/></g>)}</svg><div className="history-detail-metrics"><div><span>Inicio del período</span><b>{selected.firstGapPct > 0 ? "+" : ""}{selected.firstGapPct.toFixed(1)}%</b></div><div><span>Brecha más reciente</span><b>{selected.latestGapPct > 0 ? "+" : ""}{selected.latestGapPct.toFixed(1)}%</b></div><div><span>Mejor posición DAKA</span><b>{selected.bestDakaGapPct.toFixed(1)}%</b></div><div><span>Peor posición DAKA</span><b>{selected.worstDakaGapPct > 0 ? "+" : ""}{selected.worstDakaGapPct.toFixed(1)}%</b></div></div><div className={`competitive-conclusion ${selected.latestGapPct <= 0 ? "favorable" : "unfavorable"}`}><span>Conclusión del período</span><strong>{movementLabel(selected.movement)}</strong><p>{selected.latestGapPct > 0 ? `${competitorName} está ${Math.abs(selected.latestGapPct).toFixed(1)}% más económico y reporta ${selected.competitorLowerDays} días con ventaja.` : `DAKA está ${Math.abs(selected.latestGapPct).toFixed(1)}% más económico y reporta ${selected.dakaLowerDays} días con ventaja.`}</p></div><div className="point-history"><h3>Últimos movimientos comparables</h3>{[...detail.points].reverse().slice(0, 10).map((point) => <div key={point.date}><span>{formatDay(point.date)}</span><b>{money.format(point.dakaPrice)} / {money.format(point.competitorPrice)}</b><em className={point.gapPct <= 0 ? "comparison-favorable" : "comparison-unfavorable"}>{point.gapPct > 0 ? "+" : ""}{point.gapPct.toFixed(1)}%</em></div>)}</div></> : <div className="empty-state detail-empty">Selecciona un producto para analizar su evolución competitiva.</div>}</article>
    </section>
  </>;
}
