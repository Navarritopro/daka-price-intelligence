"use client";

import { useEffect, useState } from "react";
import { apiRequest, isAbortError } from "@/lib/api-client";
import type { DataQualityResponse } from "@/lib/types";
import type { ExecutiveGap, ExecutivePosition, SourceSnapshot } from "@/lib/executive-summary";

type ExecutiveResponse = {
  generatedAt: string;
  definition: string;
  sources: SourceSnapshot[];
  position: ExecutivePosition;
};

const integer = new Intl.NumberFormat("es-VE");
const money = new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD" });
const vetDate = new Intl.DateTimeFormat("es-VE", {
  timeZone: "America/Caracas", day: "2-digit", month: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit"
});
const levelNames = { healthy: "Correcta", warning: "Advertencia", critical: "Crítica", pending: "Sin línea base" };

function date(value: string | null) {
  return value ? `${vetDate.format(new Date(value))} VET` : "Sin captura";
}

function GapList({ title, items, empty }: { title: string; items: ExecutiveGap[]; empty: string }) {
  return <section className="exec-panel">
    <div className="exec-panel-head"><h2>{title}</h2><span>Hasta 5 SKU · diferencia ≥ 5%</span></div>
    {items.length ? <ol className="exec-gaps">{items.map((item) => <li key={`${item.sku}-${item.source}`}>
      <div><strong>{item.dakaName}</strong><small>DAKA · {item.sku}</small></div>
      <div><span>{item.sourceName}: {item.competitorName}</span><small>DAKA {money.format(item.dakaPrice)} · competencia {money.format(item.competitorPrice)}</small></div>
      <b>{item.gapPct > 0 ? "+" : ""}{item.gapPct.toFixed(1)}% · {money.format(Math.abs(item.gapUsd))}</b>
      <div className="exec-gap-links">{item.dakaUrl && <a href={item.dakaUrl} target="_blank" rel="noreferrer">DAKA ↗</a>}{item.competitorUrl && <a href={item.competitorUrl} target="_blank" rel="noreferrer">Competencia ↗</a>}</div>
    </li>)}</ol> : <p className="exec-empty">{empty}</p>}
  </section>;
}

export default function ExecutiveSummary({ onOpenMonitoring, onOpenComparison, onOpenCatalog }: {
  onOpenMonitoring: () => void;
  onOpenComparison: () => void;
  onOpenCatalog: () => void;
}) {
  const [activity, setActivity] = useState<Pick<ExecutiveResponse, "generatedAt" | "sources"> | null>(null);
  const [position, setPosition] = useState<ExecutivePosition | null>(null);
  const [quality, setQuality] = useState<DataQualityResponse | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [positionError, setPositionError] = useState<string | null>(null);
  const [qualityError, setQualityError] = useState(false);
  const [activityPending, setActivityPending] = useState(true);
  const [positionPending, setPositionPending] = useState(true);
  const [qualityPending, setQualityPending] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const loading = activityPending || positionPending || qualityPending;

  useEffect(() => {
    const controller = new AbortController();
    setActivityPending(true);
    setPositionPending(true);
    setQualityPending(true);
    setActivityError(null);
    setPositionError(null);
    setQualityError(false);
    const options = { cache: "no-store" as const, signal: controller.signal };
    void apiRequest<ExecutiveResponse>("/api/executive-summary?section=activity", options, { fallbackMessage: "No fue posible cargar las capturas", retries: 1 })
      .then((result) => { if (!controller.signal.aborted) setActivity({ generatedAt: result.generatedAt, sources: result.sources }); })
      .catch((reason: unknown) => { if (!controller.signal.aborted && !isAbortError(reason)) setActivityError(reason instanceof Error ? reason.message : "No fue posible cargar las capturas"); })
      .finally(() => { if (!controller.signal.aborted) setActivityPending(false); });
    void apiRequest<ExecutiveResponse>("/api/executive-summary?section=position", options, { fallbackMessage: "No fue posible comparar los precios", retries: 1 })
      .then((result) => { if (!controller.signal.aborted) setPosition(result.position); })
      .catch((reason: unknown) => { if (!controller.signal.aborted && !isAbortError(reason)) setPositionError(reason instanceof Error ? reason.message : "No fue posible comparar los precios"); })
      .finally(() => { if (!controller.signal.aborted) setPositionPending(false); });
    void apiRequest<DataQualityResponse>("/api/data-quality", options, { fallbackMessage: "No fue posible evaluar la calidad", retries: 1 })
      .then((result) => { if (!controller.signal.aborted) setQuality(result); })
      .catch((reason: unknown) => { if (!controller.signal.aborted && !isAbortError(reason)) setQualityError(true); })
      .finally(() => { if (!controller.signal.aborted) setQualityPending(false); });
    return () => controller.abort();
  }, [refresh]);

  return <main className="executive-summary" aria-labelledby="exec-title">
    <header className="exec-intro"><div><span className="exec-eyebrow">Lectura gerencial · precios de mercado</span><h1 id="exec-title">Resumen ejecutivo</h1><p>Posición de DAKA, movimientos de las últimas capturas, disponibilidad y confiabilidad de las fuentes. Los indicadores son de inteligencia de precios, no ventas ni rentabilidad.</p></div><div className="exec-actions"><button onClick={() => setRefresh((value) => value + 1)} disabled={loading}>{activityPending ? "Cargando capturas…" : positionPending ? "Comparando precios…" : qualityPending ? "Evaluando calidad…" : "Actualizar resumen"}</button><small>Corte de capturas: {activity ? date(activity.generatedAt) : "Pendiente"}</small></div></header>
    <p className="exec-method">Últimas dos capturas exitosas por fuente; comparación web homologada con precios y disponibilidad confirmados en las últimas 48 horas. La comparación competitiva se limita a productos del catálogo web DAKA con homologación automática o confirmada; no representa todo el maestro corporativo.</p>
    {positionError && <div className="exec-state error" role="alert"><strong>{position ? "No se pudo actualizar la posición; se muestra la última lectura." : "La posición competitiva no está disponible."}</strong><span>{positionError}</span><button onClick={() => setRefresh((value) => value + 1)}>Reintentar</button></div>}
    {position ? <>
      <section className="exec-kpis" aria-label="Indicadores principales">
        <article><span>Productos DAKA comparables</span><strong>{integer.format(position.comparedProducts)}</strong><small>Precio y disponibilidad confirmados en ambas tiendas</small></article>
        <article><span>DAKA con mejor precio</span><strong>{integer.format(position.dakaBest)}</strong><small>Precio estrictamente menor que los competidores homologados disponibles · {integer.format(position.tiedBest)} empates</small></article>
        <article><span>DAKA con peor precio</span><strong>{integer.format(position.dakaWorst)}</strong><small>Precio estrictamente mayor que todos sus competidores comparables</small></article>
        <article><span>SKU con brecha de precio</span><strong>{integer.format(position.riskProducts)}</strong><small>DAKA ≥ 5% por encima de al menos un competidor</small></article>
        <article><span>SKU con ventaja de precio</span><strong>{integer.format(position.advantageProducts)}</strong><small>DAKA ≥ 5% por debajo de al menos un competidor</small></article>
      </section>
    </> : positionPending && <div className="exec-state" role="status">Calculando la posición competitiva…</div>}
      <div className="exec-sections">
        <section className="exec-panel exec-sources"><div className="exec-panel-head"><div><h2>Actividad, precios y disponibilidad</h2><p>Cada fuente compara su última captura exitosa con la exitosa inmediatamente anterior; no necesariamente corresponde al día de hoy.</p></div><button onClick={onOpenCatalog}>Ver catálogo Damasco ↗</button></div>
          {activityError && <p className="exec-empty" role="alert">{activity ? "No se pudo actualizar la actividad; se muestra la última lectura. " : ""}{activityError} <button onClick={() => setRefresh((value) => value + 1)}>Reintentar</button></p>}
          {activity ? <div className="table-scroll"><table><thead><tr><th>Fuente</th><th>Capturas</th><th>Productos</th><th>Precios</th><th>Disponibles</th><th>Sin disponibilidad</th><th>Subieron</th><th>Bajaron</th><th>Comparables</th></tr></thead><tbody>{activity.sources.map((source) => <tr key={source.source}><td><strong>{source.name}</strong></td><td><small>Actual: {date(source.currentAt)}</small><small>Anterior: {date(source.previousAt)}</small></td><td>{source.currentAt ? integer.format(source.captured) : "—"}</td><td>{source.currentAt ? integer.format(source.withPrice) : "—"}</td><td>{source.currentAt ? integer.format(source.available) : "—"}</td><td>{source.currentAt ? integer.format(source.unavailable) : "—"}</td><td>{source.previousAt ? integer.format(source.increased) : "—"}</td><td>{source.previousAt ? integer.format(source.decreased) : "—"}</td><td>{source.previousAt ? integer.format(source.compared) : "—"}</td></tr>)}</tbody></table></div> : activityPending && <p className="exec-empty" role="status">Cargando las últimas capturas…</p>}
          <p className="exec-footnote">“Comparables” requiere precio válido en ambas capturas del mismo producto. La disponibilidad desconocida no se interpreta como cero ni como agotado.</p>
        </section>
        <section className="exec-panel exec-quality"><div className="exec-panel-head"><div><h2>Calidad de las capturas</h2><p>Evaluación existente del centro de calidad y cobertura.</p></div><button onClick={onOpenMonitoring}>Ver diagnóstico ↗</button></div>
          {qualityError && <p className="exec-empty" role="alert">No se pudo actualizar la calidad. Consulta Monitoreo técnico.</p>}
          {quality ? <><div className="exec-quality-stats"><span>Correctas <b>{quality.summary.healthy}</b></span><span>Advertencias <b>{quality.summary.warning}</b></span><span>Críticas <b>{quality.summary.critical}</b></span><span>Sin línea base <b>{quality.summary.pending}</b></span></div><ul>{quality.sources.map((source) => <li key={source.source}><strong>{source.sourceName}</strong><span className={`exec-quality-state ${source.level}`}>{levelNames[source.level]}</span><small>{source.latestSuccessAt ? date(source.latestSuccessAt) : "Sin captura exitosa"}</small></li>)}</ul></> : qualityPending && <p className="exec-empty" role="status">Evaluando calidad…</p>}
        </section>
      </div>
      {position && <><div className="exec-sections exec-opportunity-readout">
        <GapList title="Mayores brechas frente a DAKA" items={position.topRisks} empty="No hay brechas confirmables ≥ 5% entre ofertas comparables y recientes."/>
        <GapList title="Mayores ventajas de DAKA" items={position.topAdvantages} empty="No hay ventajas confirmables ≥ 5% entre ofertas comparables y recientes."/>
      </div>
      <div className="exec-followup"><p>Estas brechas son una lectura de precios vigente, no tareas de seguimiento ni decisiones automáticas de ajuste.</p><button onClick={onOpenComparison}>Abrir comparador ↗</button></div></>}
  </main>;
}
