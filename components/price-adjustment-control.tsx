"use client";

import { useEffect, useState } from "react";
import { readApiJson } from "@/lib/api-client";
import { priceAdjustmentNote, type PriceAdjustment, type PriceAdjustmentSource } from "@/lib/price-adjustment";
import styles from "./venelectronics-price-adjustment.module.css";

export default function PriceAdjustmentControl({ source = "venelectronics", canAdmin = false, controls = false }: { source?: PriceAdjustmentSource; canAdmin?: boolean; controls?: boolean }) {
  const isDaka = source === "daka";
  const label = isDaka ? "DAKA" : "Venelectronics";
  const maximum = isDaka ? 99 : 100;
  const action = isDaka ? "descuento" : "incremento";
  const endpoint = isDaka ? "/api/price-adjustment?source=daka" : "/api/price-adjustment";
  const [settings, setSettings] = useState<PriceAdjustment | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [percentage, setPercentage] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then(response => readApiJson<PriceAdjustment>(response, `No se pudo consultar el ajuste de ${label}`))
      .then(value => { if (!controller.signal.aborted) { setSettings(value); setEnabled(value.enabled); setPercentage(String(value.percentage)); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "No se pudo consultar el ajuste"); });
    return () => controller.abort();
  }, [endpoint, label]);

  useEffect(() => {
    if (controls || !settings) return;
    const controller = new AbortController();
    const check = async () => {
      try {
        const latest = await readApiJson<PriceAdjustment>(await fetch(endpoint, { cache: "no-store", signal: controller.signal }));
        if (!controller.signal.aborted && (latest.enabled !== settings.enabled || latest.percentage !== settings.percentage)) setStale(true);
      } catch { /* El aviso inicial sigue visible; no sustituye datos por un estado inventado. */ }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => { controller.abort(); window.removeEventListener("focus", onVisible); document.removeEventListener("visibilitychange", onVisible); };
  }, [controls, settings, endpoint]);

  async function save() {
    const value = Number(percentage);
    if (!Number.isInteger(value) || value < 1 || value > maximum) { setError(`Indica un porcentaje entero entre 1 y ${maximum}.`); return; }
    setBusy(true);
    setError(null);
    try {
      await readApiJson<PriceAdjustment>(await fetch(endpoint, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, percentage: value }), cache: "no-store"
      }), "No se pudo guardar el ajuste");
      // Descarta también los resúmenes y fichas que estaban cargados con el ajuste anterior.
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar el ajuste");
      setBusy(false);
    }
  }

  if (!controls && !error && !settings?.enabled && !stale) return null;
  return <section className={`${styles.panel}${isDaka ? ` ${styles.daka}` : ""}`} aria-label={`Ajuste de precio ${label}`}>
    <strong>{label} · {settings?.enabled ? `${action} activo ${settings.percentage}%` : "ajuste de precio"}</strong>
    {settings && <p>{controls ? `${priceAdjustmentNote(settings.enabled ? settings.percentage : 0, source)} Las comparaciones y los históricos mostrados usan el ajuste vigente.` : `Las vistas y los reportes usan el ${action} vigente. Los precios guardados por el scraping permanecen originales.${isDaka ? " Base Otras no se modifica." : ""}`}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {stale && <div role="alert"><p>La configuración de {label} cambió. Actualiza las vistas para usar el ajuste vigente.</p><button type="button" onClick={() => window.location.reload()}>Actualizar vistas</button></div>}
    {controls && !settings && !error && <p role="status">Consultando configuración…</p>}
    {controls && settings && canAdmin && <form className={styles.controls} onSubmit={event => { event.preventDefault(); void save(); }}>
      <label><input type="checkbox" checked={enabled} disabled={busy} onChange={event => setEnabled(event.target.checked)}/> Activar {action} para todo el catálogo web</label>
      <label>{isDaka ? "Descuento (%)" : "Incremento (%)"}<input aria-label={`Porcentaje de ${action} ${label}`} type="number" min="1" max={maximum} step="1" required value={percentage} disabled={busy} onChange={event => setPercentage(event.target.value)}/></label>
      <button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar y actualizar vistas"}</button>
      <small>Ejemplo sobre USD 250,00: {new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD" }).format(250 * (1 + (isDaka ? -1 : 1) * (enabled && Number(percentage) >= 1 && Number(percentage) <= maximum ? Number(percentage) : 0) / 100))}. El precio web guardado permanece igual.</small>
    </form>}
    {controls && !canAdmin && <small>Solo los administradores pueden modificar este ajuste.</small>}
  </section>;
}
