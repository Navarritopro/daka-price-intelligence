"use client";

import { useCallback, useEffect, useState } from "react";
import { MATCH_CORRECTION_REASON_LABELS, type MatchCorrectionReason, type MatchManagementAction } from "@/lib/match-management";

type Product = { id: number; externalId: string; name: string; brand: string | null; model: string | null; category: string | null; url: string; price: number | null; inStock: boolean | null };
type Audit = { action: "deactivated" | "replaced" | "restored"; reason: MatchCorrectionReason; notes: string | null; actor: string | null; createdAt: string };
type ManagedMatch = { matchId: number; status: string; confidence: number; matchMethod: string; createdAt: string; updatedAt: string; daka: Product; competitor: Product; audit: Audit | null };
type Page = { items: ManagedMatch[]; total: number; offset: number; limit: number; hasMore: boolean; brands: string[]; error?: string };
type DialogState = { action: MatchManagementAction; match: ManagedMatch } | null;

const money = new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD" });
const integer = new Intl.NumberFormat("es-VE");
const dateTime = new Intl.DateTimeFormat("es-VE", { timeZone: "America/Caracas", dateStyle: "short", timeStyle: "short" });
const PAGE_SIZE = 20;

const actionLabels: Record<Audit["action"], string> = {
  deactivated: "Desactivada", replaced: "Corregida", restored: "Restaurada"
};

function ProductIdentity({ product, store, competitorName }: { product: Product; store: "daka" | "competitor"; competitorName: string }) {
  return <div className={`managed-product ${store}`}>
    <span className="managed-store-label">{store === "daka" ? "DAKA" : competitorName}</span>
    <strong>{product.name}</strong>
    <small>{store === "daka" ? "SAP" : "Ref."} {product.externalId}{product.brand ? ` · ${product.brand}` : ""}</small>
    <div><b>{product.price == null ? "Sin precio" : money.format(product.price)}</b><span>{product.inStock === false ? "Sin disponibilidad" : "Disponible"}</span></div>
    <a href={product.url} target="_blank" rel="noreferrer">Abrir producto ↗</a>
  </div>;
}

export default function MatchManagement({ source, competitorName, onBack, onChanged }: { source: string; competitorName: string; onBack: () => void; onChanged: () => void }) {
  const [state, setState] = useState<"active" | "inactive">("active");
  const [items, setItems] = useState<ManagedMatch[]>([]);
  const [total, setTotal] = useState(0);
  const [brands, setBrands] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [brand, setBrand] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [reason, setReason] = useState<MatchCorrectionReason | "">("");
  const [notes, setNotes] = useState("");
  const [candidateSearch, setCandidateSearch] = useState("");
  const [debouncedCandidateSearch, setDebouncedCandidateSearch] = useState("");
  const [candidates, setCandidates] = useState<Product[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<Product | null>(null);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 350); return () => window.clearTimeout(timer); }, [search]);
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedCandidateSearch(candidateSearch.trim()), 350); return () => window.clearTimeout(timer); }, [candidateSearch]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ source, state, search: debouncedSearch, brand, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      const response = await fetch(`/api/matches/manage?${params}`, { cache: "no-store", signal });
      const payload = await response.json() as Page;
      if (!response.ok) throw new Error(payload.error ?? "No fue posible cargar las homologaciones");
      setItems(payload.items); setTotal(payload.total); setBrands(payload.brands ?? []);
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      setError(requestError instanceof Error ? requestError.message : "No fue posible cargar las homologaciones");
    } finally { setLoading(false); }
  }, [brand, debouncedSearch, page, source, state]);

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load, refresh]);
  useEffect(() => { setPage(0); setBrand(""); setSearch(""); }, [source]);
  useEffect(() => { setPage(0); }, [state, brand, debouncedSearch]);

  useEffect(() => {
    if (!dialog || dialog.action !== "replace") return;
    const controller = new AbortController();
    setCandidateLoading(true);
    const params = new URLSearchParams({ mode: "candidates", source, matchId: String(dialog.match.matchId), search: debouncedCandidateSearch, limit: "30" });
    fetch(`/api/matches/manage?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "No fue posible consultar candidatos"); return payload; })
      .then((payload) => setCandidates(payload.items ?? []))
      .catch((requestError) => { if (!(requestError instanceof DOMException && requestError.name === "AbortError")) setError(requestError instanceof Error ? requestError.message : "No fue posible consultar candidatos"); })
      .finally(() => setCandidateLoading(false));
    return () => controller.abort();
  }, [debouncedCandidateSearch, dialog, source]);

  function openDialog(action: MatchManagementAction, match: ManagedMatch) {
    setDialog({ action, match }); setReason(action === "restore" ? "restore_previous" : ""); setNotes(""); setCandidateSearch(""); setCandidates([]); setSelectedCandidate(null); setError(null);
  }

  async function submit() {
    if (!dialog || !reason || (dialog.action === "replace" && !selectedCandidate)) return;
    const confirmation = dialog.action === "replace"
      ? `¿Confirmas reemplazar la comparación con ${dialog.match.competitor.name} por ${selectedCandidate?.name}?`
      : dialog.action === "deactivate" ? "¿Confirmas desactivar esta homologación? No se borrará su historial."
        : "¿Confirmas restaurar esta homologación?";
    if (!window.confirm(confirmation)) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/matches/manage", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: dialog.action, matchId: dialog.match.matchId, replacementProductId: selectedCandidate?.id ?? null, reason, notes, expectedUpdatedAt: dialog.match.updatedAt }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No fue posible guardar la corrección");
      setDialog(null); setRefresh((value) => value + 1); onChanged();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "No fue posible guardar la corrección"); }
    finally { setSaving(false); }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return <section className={`match-management competitor-history source-${source}`}>
    <div className="management-heading"><div><button className="text-button" type="button" onClick={onBack}>← Volver al comparador</button><span className="eyebrow-dark">Control administrativo</span><h2>Gestión de homologaciones · {competitorName}</h2><p>Corrige o desactiva comparaciones sin eliminar información histórica.</p></div></div>
    <div className="management-toolbar">
      <nav className="management-state-tabs" aria-label="Estado de homologación"><button className={state === "active" ? "active" : ""} onClick={() => setState("active")}>Activas</button><button className={state === "inactive" ? "active" : ""} onClick={() => setState("inactive")}>Desactivadas</button></nav>
      <input aria-label="Buscar homologación" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto, SAP o referencia"/>
      <select aria-label="Filtrar por marca" value={brand} onChange={(event) => setBrand(event.target.value)}><option value="">Todas las marcas</option>{brands.map((item) => <option key={item} value={item}>{item}</option>)}</select>
    </div>
    {error && <div className="error-banner"><strong>No se pudo completar la operación</strong><span>{error}</span></div>}
    <div className="section-head"><h2>{state === "active" ? "Homologaciones activas" : "Homologaciones desactivadas"}</h2><small>{loading ? "Consultando…" : `${integer.format(total)} resultados`}</small></div>
    {loading ? <div className="empty-state">Consultando homologaciones…</div> : items.length === 0 ? <div className="empty-state">No existen homologaciones con estos filtros.</div> : <div className="managed-match-list">{items.map((match) => <article className="managed-match-card" key={match.matchId}>
      <div className="managed-match-products"><ProductIdentity product={match.daka} store="daka" competitorName={competitorName}/><span className="managed-link-symbol" aria-hidden="true">↔</span><ProductIdentity product={match.competitor} store="competitor" competitorName={competitorName}/></div>
      <div className="managed-match-footer"><div><span className={`status-pill ${state}`}>{state === "active" ? "Activa" : "Desactivada"}</span><small>Confianza {(match.confidence * 100).toFixed(0)}% · Actualizada {dateTime.format(new Date(match.updatedAt))} VET</small>{match.audit && <small className="management-audit"><b>{actionLabels[match.audit.action]}</b> · {MATCH_CORRECTION_REASON_LABELS[match.audit.reason] ?? match.audit.reason} · {match.audit.actor ?? "Administrador"} · {dateTime.format(new Date(match.audit.createdAt))} VET{match.audit.notes ? ` · ${match.audit.notes}` : ""}</small>}</div>
        <div className="managed-match-actions">{state === "active" ? <><button className="secondary-button" onClick={() => openDialog("replace", match)}>Corregir comparación</button><button className="danger-button" onClick={() => openDialog("deactivate", match)}>Desactivar</button></> : match.audit?.action === "deactivated" ? <button className="secondary-button" onClick={() => openDialog("restore", match)}>Restaurar</button> : <small>Reemplazada por otra homologación</small>}</div></div>
    </article>)}</div>}
    {total > PAGE_SIZE && <div className="management-pagination"><button disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Anterior</button><span>Página {page + 1} de {pages}</span><button disabled={page + 1 >= pages} onClick={() => setPage((value) => value + 1)}>Siguiente</button></div>}

    {dialog && <div className="match-action-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setDialog(null); }}><aside className="match-action-drawer" role="dialog" aria-modal="true" aria-labelledby="match-action-title">
      <div className="drawer-head"><div><span className="eyebrow-dark">Acción administrativa</span><h2 id="match-action-title">{dialog.action === "replace" ? "Corregir comparación" : dialog.action === "deactivate" ? "Desactivar homologación" : "Restaurar homologación"}</h2></div><button aria-label="Cerrar" disabled={saving} onClick={() => setDialog(null)}>×</button></div>
      <div className="drawer-current"><span>Producto DAKA</span><strong>{dialog.match.daka.name}</strong><small>SAP {dialog.match.daka.externalId}</small><span>Comparado actualmente con</span><strong>{dialog.match.competitor.name}</strong><small>Ref. {dialog.match.competitor.externalId}</small></div>
      {dialog.action === "replace" && <div className="candidate-picker"><label htmlFor="candidate-search">Selecciona el producto correcto de {competitorName}</label><input id="candidate-search" value={candidateSearch} onChange={(event) => setCandidateSearch(event.target.value)} placeholder="Buscar por nombre, marca, modelo o referencia"/>{candidateLoading ? <div className="empty-state">Buscando candidatos…</div> : candidates.length === 0 ? <div className="empty-state">No hay candidatos disponibles con esta búsqueda.</div> : <div className="candidate-list">{candidates.map((candidate) => <button type="button" key={candidate.id} className={selectedCandidate?.id === candidate.id ? "selected" : ""} onClick={() => setSelectedCandidate(candidate)}><span><strong>{candidate.name}</strong><small>Ref. {candidate.externalId}{candidate.brand ? ` · ${candidate.brand}` : ""}</small></span><b>{candidate.price == null ? "Sin precio" : money.format(candidate.price)}</b></button>)}</div>}</div>}
      <label htmlFor="correction-reason">Motivo obligatorio</label><select id="correction-reason" value={reason} disabled={dialog.action === "restore"} onChange={(event) => setReason(event.target.value as MatchCorrectionReason)}><option value="">Selecciona un motivo</option>{Object.entries(MATCH_CORRECTION_REASON_LABELS).filter(([key]) => dialog.action === "restore" ? key === "restore_previous" : key !== "restore_previous").map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <label htmlFor="correction-notes">Observación opcional</label><textarea id="correction-notes" maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Agrega contexto para la auditoría"/><small>{notes.length}/500 caracteres</small>
      <div className="drawer-actions"><button className="secondary-button" disabled={saving} onClick={() => setDialog(null)}>Cancelar</button><button className={dialog.action === "deactivate" ? "danger-button" : "primary-button"} disabled={saving || !reason || (dialog.action === "replace" && !selectedCandidate)} onClick={() => void submit()}>{saving ? "Guardando…" : dialog.action === "replace" ? "Guardar corrección" : dialog.action === "deactivate" ? "Desactivar" : "Restaurar"}</button></div>
    </aside></div>}
  </section>;
}
