"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest, isAbortError } from "@/lib/api-client";
import type { DataQualityResponse, DataQualitySourceSummary, JobSummary } from "@/lib/types";

const integer = new Intl.NumberFormat("es-VE");
const dateTime = new Intl.DateTimeFormat("es-VE", {
  timeZone: "America/Caracas",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

function percent(value: number | null) {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}

function signedPercent(value: number | null) {
  if (value == null) return "Sin línea base";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function statusIcon(level: DataQualitySourceSummary["level"]) {
  if (level === "critical") return "!";
  if (level === "warning") return "△";
  if (level === "pending") return "…";
  return "✓";
}

function formattedDate(value: string | null) {
  return value ? `${dateTime.format(new Date(value))} VET` : "Sin captura exitosa";
}

export default function DataQualityCenter({
  onOpenSource
}: {
  onOpenSource: (source: JobSummary["source"]) => void;
}) {
  const [data, setData] = useState<DataQualityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<DataQualitySourceSummary | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const payload = await apiRequest<DataQualityResponse>("/api/data-quality", { cache: "no-store", signal }, {
        retries: 1,
        fallbackMessage: "No fue posible cargar el control de calidad"
      });
      setData(payload);
    } catch (requestError) {
      if (isAbortError(requestError)) return;
      setError(requestError instanceof Error ? requestError.message : "No fue posible cargar el control de calidad");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const incidentCount = useMemo(
    () => data?.sources.reduce((total, source) => total + source.issues.length, 0) ?? 0,
    [data]
  );

  if (loading && !data) {
    return <section className="quality-loading" aria-live="polite"><span aria-hidden="true"/><strong>Evaluando las seis fuentes…</strong><small>Comparando capturas, persistencia, precios y homologaciones.</small></section>;
  }
  if (error && !data) {
    return <section className="quality-error" role="alert"><div><strong>No se pudo completar la evaluación</strong><span>{error}</span></div><button type="button" onClick={() => void load()}>Reintentar</button></section>;
  }

  return (
    <section className="data-quality-center" aria-labelledby="quality-title">
      <header className="quality-intro">
        <div>
          <span className="quality-eyebrow">Control preventivo</span>
          <h2 id="quality-title">Calidad y cobertura de datos</h2>
          <p>Confirma si cada captura es reciente, completa y comparable antes de utilizarla en decisiones comerciales.</p>
        </div>
        <div className="quality-refresh">
          <small>Actualizado {data ? formattedDate(data.generatedAt) : "—"}</small>
          <button type="button" onClick={() => void load()} disabled={loading}>{loading ? "Actualizando…" : "Actualizar evaluación"}</button>
        </div>
      </header>

      <div className="quality-summary" aria-label="Resumen de calidad">
        <article className="healthy"><span>Correctas</span><strong>{data?.summary.healthy ?? 0}</strong><small>Sin alertas activas</small></article>
        <article className="warning"><span>Con advertencias</span><strong>{data?.summary.warning ?? 0}</strong><small>Conviene revisar</small></article>
        <article className="critical"><span>Críticas</span><strong>{data?.summary.critical ?? 0}</strong><small>No usar sin validar</small></article>
        <article className="pending"><span>Sin línea base</span><strong>{data?.summary.pending ?? 0}</strong><small>Pendientes de captura</small></article>
        <article className="neutral"><span>Hallazgos</span><strong>{incidentCount}</strong><small>Reglas activadas</small></article>
      </div>

      {error && <div className="quality-inline-warning" role="status">La actualización falló; se conservan los últimos resultados visibles. {error}</div>}

      <div className="quality-table-card">
        <div className="quality-table-head"><div><h3>Matriz de integridad por fuente</h3><small>La cobertura de homologación es informativa: un producto puede no tener equivalente real.</small></div><span>6 fuentes supervisadas</span></div>
        <div className="table-scroll" tabIndex={0} aria-label="Tabla desplazable de calidad por fuente">
          <table className="quality-table">
            <thead><tr><th>Fuente y estado</th><th>Última captura</th><th>Guardado</th><th>Catálogo vs. anterior</th><th>Con precio</th><th>Altas / ausentes</th><th>Homologados</th><th>Detalle</th></tr></thead>
            <tbody>
              {data?.sources.map((source) => (
                <tr key={source.source} className={`quality-row ${source.level}`}>
                  <td><strong>{source.sourceName}</strong><span className={`quality-status ${source.level}`}><b aria-hidden="true">{statusIcon(source.level)}</b>{source.label}</span></td>
                  <td><strong>{formattedDate(source.latestSuccessAt)}</strong><small>{source.ageHours == null ? "Sin antigüedad calculable" : `Hace ${source.ageHours.toFixed(1)} h`}</small></td>
                  <td><strong>{percent(source.persistenceRate)}</strong><small>{integer.format(source.productsSaved)} de {integer.format(Math.max(0, source.productsFound - source.productsWithoutSku))}</small></td>
                  <td><strong className={source.catalogChangePercent != null && source.catalogChangePercent <= -15 ? "quality-negative" : ""}>{signedPercent(source.catalogChangePercent)}</strong><small>{integer.format(source.currentProducts)} productos actuales</small></td>
                  <td><strong>{percent(source.priceCoveragePercent)}</strong><small>{integer.format(source.productsWithPrice)} productos</small></td>
                  <td><strong>+{integer.format(source.newProducts)} / −{integer.format(source.missingProducts)}</strong><small>Últimas dos capturas exitosas</small></td>
                  <td><strong>{percent(source.matchCoveragePercent)}</strong><small>{integer.format(source.matchedProducts)} válidos · {integer.format(source.reviewMatches)} por revisar</small></td>
                  <td><button type="button" className="quality-detail-button" onClick={() => setSelected(source)} aria-label={`Ver diagnóstico de ${source.sourceName}`}>Ver diagnóstico</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <details className="quality-rules">
        <summary>¿Cómo se determina el estado?</summary>
        <div><p><strong>Crítico:</strong> captura vacía, ejecución reciente fallida, captura con más de 48 horas, guardado menor a 95%, caída de catálogo de 30% o más, o menos de 70% con precio.</p><p><strong>Advertencia:</strong> captura con más de 30 horas, guardado menor a 99,5%, caída de catálogo de 15% o más, o menos de 90% con precio.</p><p><strong>Línea base:</strong> si no existe una captura anterior, la variación se muestra pendiente y no penaliza la fuente.</p></div>
      </details>

      {selected && <div className="quality-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><aside className="quality-drawer" role="dialog" aria-modal="true" aria-labelledby="quality-detail-title"><header><div><span className={`quality-status ${selected.level}`}><b aria-hidden="true">{statusIcon(selected.level)}</b>{selected.label}</span><h2 id="quality-detail-title">{selected.sourceName}</h2><small>Diagnóstico de la última captura exitosa frente a su antecedente.</small></div><button type="button" onClick={() => setSelected(null)} aria-label="Cerrar diagnóstico">×</button></header><div className="quality-drawer-body">
        {selected.issues.length ? <div className="quality-issues">{selected.issues.map((issue) => <article key={issue.code} className={issue.level}><strong>{issue.title}</strong><p>{issue.detail}</p></article>)}</div> : <div className="quality-all-clear"><strong>No se activó ninguna regla de riesgo</strong><span>La captura cumple los umbrales operativos definidos.</span></div>}
        <dl className="quality-detail-grid"><div><dt>Encontrados</dt><dd>{integer.format(selected.productsFound)}</dd></div><div><dt>Guardados</dt><dd>{integer.format(selected.productsSaved)}</dd></div><div><dt>Sin SKU</dt><dd>{integer.format(selected.productsWithoutSku)}</dd></div><div><dt>Páginas / bloques</dt><dd>{integer.format(selected.pagesScanned)}</dd></div><div><dt>Captura anterior</dt><dd>{selected.previousProducts == null ? "Sin línea base" : integer.format(selected.previousProducts)}</dd></div><div><dt>Último intento</dt><dd>{selected.latestAttemptStatus ?? "Sin registro"}</dd></div></dl>
        <div className="quality-actions"><button type="button" onClick={() => { setSelected(null); onOpenSource(selected.source); }}>Abrir operación de esta fuente</button><a href={selected.baseUrl} target="_blank" rel="noreferrer">Validar sitio de origen ↗</a></div>
      </div></aside></div>}
    </section>
  );
}
