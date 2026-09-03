"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardData, JobSummary, ProductSummary } from "@/lib/types";

type PricePoint = { price: number; scrapedAt: string; changePct: number | null };
type View = "prices" | "operations";

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
  const [summary, setSummary] = useState<DashboardData | null>(null);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [selected, setSelected] = useState<ProductSummary | null>(null);
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [search, setSearch] = useState("");
  const [changeFilter, setChangeFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryResponse, productResponse, jobsResponse] = await Promise.all([
        fetch("/api/dashboard", { cache: "no-store" }),
        fetch("/api/products?limit=100", { cache: "no-store" }),
        fetch("/api/jobs", { cache: "no-store" })
      ]);
      if (!summaryResponse.ok || !productResponse.ok || !jobsResponse.ok) throw new Error("API unavailable");
      const [summaryData, productData, jobsData] = await Promise.all([
        summaryResponse.json(), productResponse.json(), jobsResponse.json()
      ]);
      setSummary(summaryData);
      setProducts(productData);
      setJobs(jobsData);
      setSelected((current) => current ?? productData[0] ?? null);
    } catch {
      setError("No fue posible cargar la información. Verifica la conexión con PostgreSQL.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selected) { setHistory([]); return; }
    fetch(`/api/products/${selected.id}/history`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [selected]);

  const filteredProducts = useMemo(() => products.filter((product) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || product.name.toLowerCase().includes(query) || product.externalId.toLowerCase().includes(query);
    const matchesChange = changeFilter === "all" ||
      (changeFilter === "down" && (product.changePct ?? 0) < 0) ||
      (changeFilter === "up" && (product.changePct ?? 0) > 0) ||
      (changeFilter === "same" && (product.changePct ?? 0) === 0);
    return matchesSearch && matchesChange;
  }), [products, search, changeFilter]);

  const chart = useMemo(() => chartPath(history), [history]);

  async function triggerScrape() {
    const key = window.prompt("Ingresa la clave administrativa para iniciar el scraping:");
    if (!key) return;
    setRunning(true);
    try {
      const response = await fetch("/api/scrape", { method: "POST", headers: { "x-admin-key": key } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No fue posible iniciar la ejecución");
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
  const prices = history.map((point) => point.price);
  const maxPrice = prices.length ? Math.max(...prices) : null;
  const minPrice = prices.length ? Math.min(...prices) : null;

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
          <button className="primary-button" onClick={triggerScrape} disabled={running}>{running ? "Iniciando…" : "Actualizar datos ahora"}</button>
        </div>
      </header>

      {error && <div className="error-banner"><strong>Conexión pendiente</strong><span>{error}</span><button onClick={() => void load()}>Reintentar</button></div>}

      {view === "prices" ? (
        <main>
          <section className="hero-grid">
            <article className="intro-card"><div className="eyebrow">Inteligencia de precios · Fase 1</div><h1>El histórico del catálogo Daka, en una sola vista.</h1><p>Seguimiento diario en USD, identificación de variaciones y trazabilidad exacta de cada captura.</p></article>
            <div className="hero-stats">
              <article className="stat-card"><span>Catálogo monitoreado</span><strong>{loading ? "…" : integer.format(summary?.productsMonitored ?? 0)}</strong><em>{summary?.productsWithPrice ?? 0} con precio</em></article>
              <article className="stat-card accent"><span>Oportunidades de rebaja</span><strong>{loading ? "…" : integer.format(summary?.priceDropsToday ?? 0)}</strong><em>Detectadas hoy</em></article>
              <article className="stat-card"><span>Precio promedio</span><strong>{loading ? "…" : money.format(summary?.averagePrice ?? 0)}</strong><em>{summary?.changesToday ?? 0} cambios ≥ ±5%</em></article>
              <article className="stat-card"><span>Último scraping</span><strong>{summary?.lastJobStatus === "success" ? "Exitoso" : summary?.lastJobStatus ?? "Pendiente"}</strong><em>{formatDuration(summary?.lastJobDurationSeconds)} · {formatDate(summary?.lastScrapeAt)}</em></article>
            </div>
          </section>

          <div className="tabs"><button className="tab active">Explorar precios</button><button className="tab">Cambios del día</button><button className="tab">Histórico</button><button className="tab locked" title="Disponible en Fase 2">🔒 Competidores</button></div>
          <section className="filters"><input aria-label="Buscar producto" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto o código SAP"/><select aria-label="Categoría" disabled><option>Todas las categorías</option></select><select aria-label="Variación" value={changeFilter} onChange={(event) => setChangeFilter(event.target.value)}><option value="all">Cualquier variación</option><option value="down">Rebajas</option><option value="up">Aumentos</option><option value="same">Sin cambios</option></select><select aria-label="Período" disabled><option>Últimos 90 días</option></select></section>

          <section className="content-grid">
            <article className="product-list"><div className="section-head"><h2>Productos monitoreados</h2><small>{filteredProducts.length} resultados</small></div><div className="product-scroll">
              {!loading && filteredProducts.length === 0 && <div className="empty-state">No hay productos que coincidan con los filtros.</div>}
              {filteredProducts.map((product) => <button key={product.id} className={selected?.id === product.id ? "product-row active" : "product-row"} onClick={() => setSelected(product)}><div><b>{product.name}</b><p>{product.externalId} · {product.category ?? "Sin categoría"}</p></div><div className="product-price"><strong>{product.currentPrice == null ? "Sin precio" : money.format(product.currentPrice)}</strong><span className={`variation ${changeClass(product.changePct)}`}>{product.changePct == null ? "—" : `${product.changePct > 0 ? "+" : ""}${product.changePct.toFixed(1)}%`}</span></div></button>)}
            </div></article>
            <article className="detail-card">
              {selected ? <><div className="detail-main"><div className="detail-title"><div><h2>{selected.name}</h2><div className="meta"><span className="source-badge">D</span> Tiendas Daka · SAP {selected.externalId}</div></div><div className="current-price"><span className="meta">Precio actual</span><strong>{selected.currentPrice == null ? "Sin precio" : money.format(selected.currentPrice)}</strong><span className={`variation ${changeClass(selected.changePct)}`}>{selected.changePct == null ? "Sin comparación" : `${selected.changePct > 0 ? "+" : ""}${selected.changePct.toFixed(1)}% vs. captura anterior`}</span></div></div>
                {history.length ? <svg className="price-chart" viewBox="0 0 760 245" role="img" aria-label="Histórico de precio"><defs><linearGradient id="priceArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1258d9" stopOpacity=".2"/><stop offset="1" stopColor="#1258d9" stopOpacity="0"/></linearGradient></defs><line className="chart-grid" x1="45" y1="45" x2="735" y2="45"/><line className="chart-grid" x1="45" y1="115" x2="735" y2="115"/><line className="chart-grid" x1="45" y1="190" x2="735" y2="190"/><path className="chart-area" d={chart.area}/><path className="chart-line" d={chart.line}/>{chart.dots.slice(-1).map((dot) => <circle key="last" className="chart-point" cx={dot.x} cy={dot.y} r="5"/>)}</svg> : <div className="chart-empty">El gráfico aparecerá después de la primera captura.</div>}
                <div className="mini-grid"><div><span>Precio máximo</span><b>{maxPrice == null ? "—" : money.format(maxPrice)}</b></div><div><span>Precio mínimo</span><b>{minPrice == null ? "—" : money.format(minPrice)}</b></div><div><span>Capturas</span><b>{history.length} registros</b></div><div><span>Última captura</span><b>{formatDate(selected.scrapedAt)}</b></div></div></div>
                <div className="history-table"><div className="section-head"><h2>Últimas capturas</h2><small>Fecha y hora exactas · VET</small></div><div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Precio USD</th><th>Variación</th></tr></thead><tbody>{history.slice(0, 10).map((point) => <tr key={point.scrapedAt}><td>{formatDate(point.scrapedAt)}</td><td>{money.format(point.price)}</td><td className={changeClass(point.changePct)}>{point.changePct == null ? "—" : `${point.changePct > 0 ? "+" : ""}${point.changePct.toFixed(1)}%`}</td></tr>)}</tbody></table></div></div></> : <div className="empty-state detail-empty">Selecciona un producto para consultar su histórico.</div>}
            </article>
          </section>
          <section className="roadmap"><div><strong>Preparado para crecer hacia el benchmarking competitivo</strong><span>La estructura admite nuevas tiendas sin perder el histórico de Daka.</span></div><div className="stages"><span className="stage">Fase 1 · Daka</span><span>→</span><span className="stage future">Fase 2 · Competidores</span><span>→</span><span className="stage future">Comparador</span></div></section>
        </main>
      ) : (
        <main className="operations-shell">
          <section className="operations-top"><div><div className={`service-status ${latestJob?.status === "failed" ? "failed" : ""}`}>{latestJob?.status === "running" ? "Scraping en ejecución" : latestJob?.status === "failed" ? "Última ejecución fallida" : "Servicio operativo"}</div><h1>Monitoreo técnico</h1><p>Seguimiento del proceso de extracción, persistencia y alertas.</p></div><button className="primary-button operations-run" onClick={triggerScrape} disabled={running}>▶ Iniciar ejecución manual</button></section>
          <section className="operations-metrics"><article><span>Productos extraídos</span><strong>{latestJob?.productsFound ?? 0}</strong><em>{latestJob?.status === "success" ? "✓ Proceso completado" : latestJob?.status ?? "Sin ejecuciones"}</em></article><article><span>Guardados con SAP</span><strong>{latestJob?.productsSaved ?? 0}</strong><em>Histórico persistido</em></article><article><span>Sin código SAP</span><strong>{latestJob?.productsWithoutSku ?? 0}</strong><em className="warning">Requiere revisión</em></article><article><span>Páginas</span><strong>{latestJob?.pagesScanned ?? 0}</strong><em>Procesadas</em></article><article><span>Duración</span><strong>{formatDuration(latestJob?.durationSeconds)}</strong><em>Última ejecución</em></article></section>
          <section className="operations-grid"><article className="operations-panel"><div className="operations-head"><h2>Estado de la última ejecución</h2><small>{latestJob ? `Job #${latestJob.id.slice(0, 13)}` : "Sin ejecuciones"}</small></div><div className="pipeline"><div className="step"><i>✓</i><div><span>Inicialización</span><small>Conexión, job y navegador</small></div></div><div className="step"><i>✓</i><div><span>Extracción del catálogo</span><small>{latestJob?.pagesScanned ?? 0} páginas procesadas</small></div></div><div className="step"><i>✓</i><div><span>Normalización y validación</span><small>Precios USD y códigos SAP</small></div></div><div className="step"><i>✓</i><div><span>Persistencia y alertas</span><small>{latestJob?.productsSaved ?? 0} productos guardados</small></div></div></div></article>
          <article className="operations-panel"><div className="operations-head"><h2>Registro de actividad</h2><small>Hora Venezuela</small></div><div className="terminal">{latestJob?.logs?.length ? latestJob.logs.map((log, index) => <div key={`${log.time}-${index}`}><span className={log.level}>{log.time}</span> {log.message}</div>) : <div><span className="info">[SISTEMA]</span> Esperando la primera ejecución…</div>}{latestJob?.errorMessage && <div><span className="error">[ERROR]</span> {latestJob.errorMessage}</div>}</div></article></section>
          <section className="operations-lower"><article className="operations-panel"><div className="operations-head"><h2>Historial de ejecuciones</h2><small>Últimos 20 procesos</small></div><div className="table-scroll"><table className="operations-table"><thead><tr><th>Job</th><th>Inicio exacto</th><th>Origen</th><th>Productos</th><th>Duración</th><th>Resultado</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td>{job.id.slice(0, 13)}</td><td>{formatDate(job.startedAt)}</td><td>{job.triggerType}</td><td>{job.productsSaved}</td><td>{formatDuration(job.durationSeconds)}</td><td><span className={`job-badge ${job.status}`}>{job.status.toUpperCase()}</span></td></tr>)}</tbody></table></div></article><article className="operations-panel"><div className="operations-head"><h2>Configuración activa</h2><small>Fase 1</small></div><div className="operations-config"><div><span>Fuente</span><b>Tiendas Daka</b></div><div><span>Frecuencia</span><b>Todos los días</b></div><div><span>Hora</span><b>08:00 AM VET</b></div><div><span>Alerta mínima</span><b>±5%</b></div><div><span>Canales</span><b>Correo · Telegram</b></div></div></article></section>
        </main>
      )}
    </div>
  );
}
