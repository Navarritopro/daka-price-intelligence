"use client";

import { useEffect, useMemo, useState } from "react";
import type { JobSummary, MonitoringSourceSummary } from "@/lib/types";

type MonitoringSource = "all" | "daka" | "damasco" | "multimax";
type ScrapeRequest = {
  id: string;
  status: "queued" | "running" | "success" | "failed";
  requestedAt: string;
  claimedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
};
type HealthLevel = "healthy" | "warning" | "failed" | "running" | "unknown";
type Health = {
  level: HealthLevel;
  label: string;
  detail: string;
  latest: JobSummary | null;
  latestSuccess: JobSummary | null;
  dropPercent: number | null;
};

type SourceSchedule = {
  time: string;
  mode: string;
  primaryMinute: number;
  backupMinutes: number[];
  backupLabels: string[];
};

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
const vetClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Caracas",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

function formatDate(value: string | null | undefined) {
  if (!value) return "Sin registros";
  return `${vetDate.format(new Date(value))} VET`;
}

function formatDuration(seconds: number | null | undefined) {
  if (seconds == null) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return hours
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function sourceSchedule(source: string): SourceSchedule {
  if (source === "damasco") return {
    time: "09:07 a. m. VET",
    mode: "GitHub Actions · principal + 2 respaldos",
    primaryMinute: 9 * 60 + 7,
    backupMinutes: [11 * 60 + 7, 13 * 60 + 7],
    backupLabels: ["11:07 a. m.", "1:07 p. m."]
  };
  if (source === "multimax") return {
    time: "09:20 a. m. VET",
    mode: "GitHub Actions · principal + 2 respaldos",
    primaryMinute: 9 * 60 + 20,
    backupMinutes: [11 * 60 + 20, 13 * 60 + 20],
    backupLabels: ["11:20 a. m.", "1:20 p. m."]
  };
  return { time: "09:00 a. m. VET", mode: "Equipo local · temporal", primaryMinute: 9 * 60, backupMinutes: [], backupLabels: [] };
}

function vetParts(value: number | string) {
  const parts = vetClock.formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "0";
  return {
    dateKey: `${part("year")}-${part("month")}-${part("day")}`,
    minute: Number(part("hour")) * 60 + Number(part("minute"))
  };
}

function getHealth(source: MonitoringSourceSummary, jobs: JobSummary[], now: number): Health {
  const sourceJobs = jobs.filter((job) => job.source === source.source);
  const latest = sourceJobs[0] ?? null;
  const successful = sourceJobs.filter((job) => job.status === "success");
  const latestSuccess = successful[0] ?? null;
  const previousSuccess = successful[1] ?? null;
  const dropPercent = latestSuccess && previousSuccess && previousSuccess.productsFound > 0
    ? ((previousSuccess.productsFound - latestSuccess.productsFound) / previousSuccess.productsFound) * 100
    : null;

  if (latest?.status === "running") {
    return { level: "running", label: "En ejecución", detail: "El progreso se actualiza cada 10 segundos", latest, latestSuccess, dropPercent };
  }
  if (!latestSuccess) {
    return {
      level: latest?.status === "failed" ? "failed" : "unknown",
      label: latest?.status === "failed" ? "Primera ejecución fallida" : "Sin ejecuciones",
      detail: latest?.errorMessage ?? "Todavía no existe una captura exitosa",
      latest,
      latestSuccess,
      dropPercent
    };
  }
  if (latest?.status === "failed" && new Date(latest.startedAt) > new Date(latestSuccess.startedAt)) {
    return { level: "failed", label: "Última ejecución fallida", detail: latest.errorMessage ?? "Revise el registro de actividad", latest, latestSuccess, dropPercent };
  }
  const schedule = sourceSchedule(source.source);
  const currentVet = vetParts(now);
  const latestSuccessVet = vetParts(latestSuccess.finishedAt ?? latestSuccess.startedAt);
  const hasSuccessToday = currentVet.dateKey === latestSuccessVet.dateKey;
  const competitor = source.source === "damasco" || source.source === "multimax";
  const graceMinutes = 45;
  if (competitor && !hasSuccessToday && currentVet.minute >= schedule.primaryMinute + graceMinutes) {
    const nextBackup = schedule.backupMinutes.findIndex((minute) => currentVet.minute < minute);
    const detail = nextBackup >= 0
      ? `GitHub aún no ha completado la captura de hoy. Próximo respaldo: ${schedule.backupLabels[nextBackup]} VET`
      : "No existe una captura exitosa de hoy después de los tres horarios programados";
    return { level: "warning", label: "Pendiente de hoy", detail, latest, latestSuccess, dropPercent };
  }
  const ageHours = (now - new Date(latestSuccess.finishedAt ?? latestSuccess.startedAt).getTime()) / 3_600_000;
  if (ageHours > 30) {
    return { level: "warning", label: "Captura atrasada", detail: `Último éxito hace ${Math.floor(ageHours)} horas`, latest, latestSuccess, dropPercent };
  }
  if (dropPercent != null && dropPercent >= 20) {
    return { level: "warning", label: "Catálogo disminuyó", detail: `La última captura bajó ${dropPercent.toFixed(1)}%`, latest, latestSuccess, dropPercent };
  }
  return { level: "healthy", label: "Operativo", detail: "Última ejecución completada correctamente", latest, latestSuccess, dropPercent };
}

function statusText(status: string) {
  if (status === "success") return "Exitoso";
  if (status === "failed") return "Fallido";
  if (status === "running") return "En ejecución";
  return "En espera";
}

function sourceName(source: string) {
  if (source === "damasco") return "Damasco";
  if (source === "multimax") return "Multimax";
  return "DAKA";
}

export default function TechnicalMonitoring({
  jobs,
  sources,
  latestRequest,
  running,
  onTriggerDaka
}: {
  jobs: JobSummary[];
  sources: MonitoringSourceSummary[];
  latestRequest: ScrapeRequest | null;
  running: boolean;
  onTriggerDaka: () => void;
}) {
  const [selectedSource, setSelectedSource] = useState<MonitoringSource>("all");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const selectedJobs = useMemo(
    () => selectedSource === "all" ? jobs : jobs.filter((job) => job.source === selectedSource),
    [jobs, selectedSource]
  );
  const sourceHealth = useMemo(
    () => sources.map((source) => ({ source, health: getHealth(source, jobs, now) })),
    [jobs, now, sources]
  );
  const selectedSummary = sources.find((source) => source.source === selectedSource) ?? null;
  const latestJob = selectedJobs[0] ?? null;
  const sourceSuccesses = selectedJobs.filter((job) => job.status === "success");
  const previousSuccess = sourceSuccesses[1] ?? sourceSuccesses[0] ?? null;
  const expectedPages = previousSuccess?.pagesScanned ?? (selectedSource === "damasco" ? 25 : selectedSource === "multimax" ? 60 : 138);
  const expectedProducts = previousSuccess?.productsFound ?? selectedSummary?.currentProducts ?? (selectedSource === "damasco" ? 1220 : selectedSource === "multimax" ? 2963 : 2205);
  const progressPercent = latestJob?.status === "success" ? 100 : latestJob?.status === "running"
    ? latestJob.productsSaved > 0
      ? Math.min(99, Math.round(80 + (latestJob.productsSaved / Math.max(expectedProducts, 1)) * 19))
      : Math.min(80, Math.round((latestJob.pagesScanned / Math.max(expectedPages, 1)) * 80))
    : 0;
  const requestWaiting = selectedSource === "daka" && latestRequest?.status === "queued";
  const requestPreparing = selectedSource === "daka" && latestRequest?.status === "running" && latestJob?.status !== "running";
  const executionBusy = running || requestWaiting || requestPreparing || (selectedSource === "daka" && latestJob?.status === "running");
  const selectedHealth = selectedSummary ? getHealth(selectedSummary, jobs, now) : null;
  const schedule = selectedSource === "all" ? null : sourceSchedule(selectedSource);
  const isDamasco = selectedSource === "damasco";
  const isCompetitor = selectedSource !== "daka" && selectedSource !== "all";
  const sourceUnit = isDamasco ? "bloques" : "páginas";
  const extractionDone = latestJob?.status === "success" || (latestJob?.productsSaved ?? 0) > 0;
  const persistenceDone = latestJob?.status === "success" || Boolean(latestJob?.status === "running" && latestJob.productsFound > 0 && latestJob.productsSaved >= latestJob.productsFound);

  return (
    <main className="operations-shell">
      <section className="operations-top">
        <div>
          <div className={`service-status ${selectedHealth?.level ?? "healthy"}`}>
            {selectedSource === "all" ? "Visión consolidada de las fuentes" : selectedHealth?.label ?? "Sin información"}
          </div>
          <h1>Monitoreo técnico</h1>
          <p>Seguimiento multifuente de extracción, persistencia, homologación y calidad del catálogo.</p>
        </div>
        {selectedSource === "daka" ? (
          <button className="primary-button operations-run" onClick={onTriggerDaka} disabled={executionBusy}>▶ {executionBusy ? "Ejecución pendiente" : "Iniciar DAKA manualmente"}</button>
        ) : isCompetitor ? (
          <a className="primary-button operations-link" href={`https://github.com/Navarritopro/daka-price-intelligence/actions/workflows/scrape-${selectedSource}.yml`} target="_blank" rel="noreferrer">Abrir GitHub Actions ↗</a>
        ) : null}
      </section>

      <nav className="monitor-source-tabs" aria-label="Fuentes del monitoreo">
        <button className={selectedSource === "all" ? "active" : ""} onClick={() => setSelectedSource("all")}>Resumen general</button>
        <button className={selectedSource === "daka" ? "active" : ""} onClick={() => setSelectedSource("daka")}>DAKA</button>
        <button className={selectedSource === "damasco" ? "active" : ""} onClick={() => setSelectedSource("damasco")}>Damasco</button>
        <button className={selectedSource === "multimax" ? "active" : ""} onClick={() => setSelectedSource("multimax")}>Multimax</button>
      </nav>

      {selectedSource === "all" ? (
        <>
          <section className="source-health-grid">
            {sourceHealth.map(({ source, health }) => {
              const sourceJobs = jobs.filter((job) => job.source === source.source);
              const successful = sourceJobs.filter((job) => job.status === "success");
              const latestSuccess = successful[0] ?? null;
              const previous = successful[1] ?? null;
              const capturedChange = latestSuccess && previous ? latestSuccess.productsFound - previous.productsFound : null;
              return (
                <button key={source.source} className={`source-health-card ${health.level}`} onClick={() => setSelectedSource(source.source)}>
                  <div className="source-health-head"><div><span className={`monitor-source-badge ${source.source}`}>{source.source === "daka" ? "D" : source.source === "damasco" ? "DM" : "MM"}</span><strong>{source.sourceName}</strong></div><span className={`health-pill ${health.level}`}>{health.label}</span></div>
                  <div className="source-health-primary"><span>Última captura exitosa</span><b>{formatDate(health.latestSuccess?.finishedAt ?? health.latestSuccess?.startedAt)}</b></div>
                  <div className="source-health-metrics"><div><span>Productos</span><b>{integer.format(source.currentProducts)}</b></div><div><span>Duración</span><b>{formatDuration(health.latestSuccess?.durationSeconds)}</b></div><div><span>Variación catálogo</span><b className={capturedChange != null && capturedChange < 0 ? "metric-warning" : ""}>{capturedChange == null ? "—" : `${capturedChange > 0 ? "+" : ""}${integer.format(capturedChange)}`}</b></div></div>
                  <p>{health.detail}</p>
                  <small>{sourceSchedule(source.source).mode} · {sourceSchedule(source.source).time}</small>
                </button>
              );
            })}
          </section>
          <section className="operations-panel consolidated-history">
            <div className="operations-head"><h2>Actividad reciente de todas las fuentes</h2><small>Últimos {Math.min(jobs.length, 20)} procesos</small></div>
            <div className="table-scroll"><table className="operations-table"><thead><tr><th>Fuente</th><th>Inicio real</th><th>Finalización</th><th>Origen</th><th>Productos</th><th>Duración</th><th>Resultado</th></tr></thead><tbody>{jobs.slice(0, 20).map((job) => <tr key={job.id}><td><button className="source-table-link" onClick={() => setSelectedSource(job.source)}>{job.sourceName}</button></td><td>{formatDate(job.startedAt)}</td><td>{formatDate(job.finishedAt)}</td><td>{job.triggerType}</td><td>{integer.format(job.productsSaved)}</td><td>{formatDuration(job.durationSeconds)}</td><td><span className={`job-badge ${job.status}`}>{statusText(job.status)}</span></td></tr>)}</tbody></table></div>
          </section>
        </>
      ) : (
        <>
          {(requestWaiting || requestPreparing) && <section className="live-progress queue-progress"><div><strong>{requestWaiting ? "Solicitud enviada" : "Solicitud recibida"}</strong><span>{requestWaiting ? "Esperando al receptor local" : "Preparando navegador y conexión"}</span></div><progress/><small>{requestWaiting ? `Solicitud #${latestRequest?.id} registrada ${formatDate(latestRequest?.requestedAt)} · puede tardar hasta dos minutos en comenzar.` : "El equipo local tomó la solicitud. El progreso aparecerá en unos segundos."}</small></section>}
          {latestJob?.status === "running" && <section className="live-progress"><div><strong>{sourceName(selectedSource)} en ejecución</strong><span>{progressPercent}% estimado · actualización automática cada 10 segundos</span></div><progress value={progressPercent} max="100"/><small>{latestJob.productsSaved > 0 ? `${isCompetitor ? "Persistiendo y homologando" : "Guardando histórico"}: ${integer.format(latestJob.productsSaved)} de ${integer.format(expectedProducts)} productos` : `Extrayendo catálogo: ${latestJob.pagesScanned} ${sourceUnit} · ${integer.format(latestJob.productsFound)} productos encontrados`}</small></section>}
          {selectedHealth?.level === "warning" && <section className="monitor-alert warning"><strong>Advertencia operativa</strong><span>{selectedHealth.detail}. Revise la ejecución antes de interpretar productos ausentes como retiros del catálogo.</span></section>}
          {selectedHealth?.level === "failed" && <section className="monitor-alert failed"><strong>Fuente requiere atención</strong><span>{selectedHealth.detail}</span></section>}

          <section className="operations-metrics"><article><span>Productos extraídos</span><strong>{integer.format(latestJob?.productsFound ?? 0)}</strong><em>{latestJob ? statusText(latestJob.status) : "Sin ejecuciones"}</em></article><article><span>Productos guardados</span><strong>{integer.format(latestJob?.productsSaved ?? 0)}</strong><em>Histórico persistido</em></article><article><span>Con precio</span><strong>{integer.format(selectedSummary?.productsWithPrice ?? 0)}</strong><em>{selectedSummary?.currentProducts ? `${((selectedSummary.productsWithPrice / selectedSummary.currentProducts) * 100).toFixed(1)}% del catálogo` : "Sin catálogo"}</em></article><article><span>{sourceUnit[0].toUpperCase() + sourceUnit.slice(1)}</span><strong>{integer.format(latestJob?.pagesScanned ?? 0)}</strong><em>Procesados</em></article><article><span>Duración</span><strong>{formatDuration(latestJob?.durationSeconds)}</strong><em>{latestJob?.status === "running" ? "Tiempo transcurrido" : "Última ejecución"}</em></article></section>

          <section className="operations-grid">
            <article className="operations-panel"><div className="operations-head"><h2>Estado de la última ejecución</h2><small>{latestJob ? `Job #${latestJob.id.slice(0, 13)}` : "Sin ejecuciones"}</small></div><div className="pipeline">
              <div className={`step ${latestJob?.status === "running" && latestJob.pagesScanned === 0 ? "active" : !latestJob ? "pending" : ""}`}><i>{latestJob ? "✓" : "…"}</i><div><span>Inicialización</span><small>{isCompetitor ? "Conexión con Neon y catálogo público" : "Conexión con Neon y navegador"}</small></div></div>
              <div className={`step ${latestJob?.status === "running" && !extractionDone ? "active" : latestJob?.status === "failed" || !latestJob ? "pending" : ""}`}><i>{extractionDone ? "✓" : "…"}</i><div><span>Extracción del catálogo</span><small>{latestJob?.pagesScanned ?? 0} {sourceUnit} · {integer.format(latestJob?.productsFound ?? 0)} productos</small></div></div>
              <div className={`step ${latestJob?.status === "running" && extractionDone && !persistenceDone ? "active" : latestJob?.status === "failed" || !latestJob ? "pending" : ""}`}><i>{persistenceDone ? "✓" : "…"}</i><div><span>Persistencia histórica</span><small>{integer.format(latestJob?.productsSaved ?? 0)} productos guardados en Neon</small></div></div>
              <div className={`step ${latestJob?.status === "running" && persistenceDone ? "active" : latestJob?.status !== "success" ? "pending" : ""}`}><i>{latestJob?.status === "success" ? "✓" : "…"}</i><div><span>{isCompetitor ? "Homologación competitiva" : "Alertas y finalización"}</span><small>{isCompetitor ? `${integer.format((selectedSummary?.autoMatches ?? 0) + (selectedSummary?.confirmedMatches ?? 0))} equivalencias · ${integer.format(selectedSummary?.reviewMatches ?? 0)} por validar` : "Cálculo de variaciones y notificaciones"}</small></div></div>
            </div></article>
            <article className="operations-panel"><div className="operations-head"><h2>Registro de actividad</h2><small>Hora Venezuela</small></div><div className="terminal">{latestJob?.logs?.length ? latestJob.logs.map((log, index) => <div key={`${log.time}-${index}`}><span className={log.level}>{log.time}</span> {log.message}</div>) : <div><span className="info">[SISTEMA]</span> Esperando la primera ejecución…</div>}{latestJob?.errorMessage && <div><span className="error">[ERROR]</span> {latestJob.errorMessage}</div>}</div></article>
          </section>

          <section className="operations-lower"><article className="operations-panel"><div className="operations-head"><h2>Historial de {sourceName(selectedSource)}</h2><small>Últimos 20 procesos</small></div><div className="table-scroll"><table className="operations-table"><thead><tr><th>Job</th><th>Inicio real</th><th>Finalización</th><th>Origen</th><th>Productos</th><th>Duración</th><th>Resultado</th></tr></thead><tbody>{selectedJobs.map((job) => <tr key={job.id}><td>{job.id.slice(0, 13)}</td><td>{formatDate(job.startedAt)}</td><td>{formatDate(job.finishedAt)}</td><td>{job.triggerType}</td><td>{integer.format(job.productsSaved)}</td><td>{formatDuration(job.durationSeconds)}</td><td><span className={`job-badge ${job.status}`}>{statusText(job.status)}</span></td></tr>)}</tbody></table></div></article><article className="operations-panel"><div className="operations-head"><h2>Configuración y calidad</h2><small>{sourceName(selectedSource)}</small></div><div className="operations-config"><div><span>Fuente</span><b>{selectedSummary?.sourceName ?? sourceName(selectedSource)}</b></div><div><span>Programación</span><b>{schedule?.time}</b></div><div><span>Ejecución</span><b>{schedule?.mode}</b></div><div><span>Último inicio real</span><b>{formatDate(latestJob?.startedAt)}</b></div><div><span>Última finalización</span><b>{formatDate(latestJob?.finishedAt)}</b></div>{isCompetitor && <><div><span>Disponibles / sin stock</span><b>{integer.format(selectedSummary?.inStock ?? 0)} / {integer.format(selectedSummary?.outOfStock ?? 0)}</b></div><div><span>Homologados</span><b>{integer.format((selectedSummary?.autoMatches ?? 0) + (selectedSummary?.confirmedMatches ?? 0))}</b></div><div><span>Por validar</span><b>{integer.format(selectedSummary?.reviewMatches ?? 0)}</b></div></>}</div></article></section>
        </>
      )}
    </main>
  );
}
