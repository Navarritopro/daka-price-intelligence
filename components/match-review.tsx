"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ReviewProduct = { id: number; externalId: string; name: string; url: string; price: number | null; inStock: boolean | null; brand?: string | null; model?: string | null; category?: string | null };
type Evidence = { engineVersion?: string; brand?: string; productType?: string; sharedModels?: string[]; sharedAttributes?: string[]; tokenSimilarity?: number; nameSimilarity?: number; warnings?: string[]; conflicts?: string[]; variantNotes?: string[]; candidateRank?: number; candidateCount?: number; candidateTotal?: number };
type ReviewCandidate = { matchId: number; confidence: number; matchMethod: string; evidence: Evidence; bulkEligible: boolean; competitor: ReviewProduct };
type ReviewGroup = { daka: ReviewProduct; candidates: ReviewCandidate[] };
type ReviewPage = { groups: ReviewGroup[]; totalProducts: number; totalAlternatives: number; safeCandidates: number; hasMore: boolean };

const money = new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD" });
const integer = new Intl.NumberFormat("es-VE");

function describeAttribute(value: string) {
  if (value.startsWith("tech:")) return value.slice(5);
  const [number, unit] = value.split(":");
  return `${number} ${unit?.toUpperCase() ?? ""}`.trim();
}

function methodLabel(method: string) {
  const labels: Record<string, string> = {
    model_brand: "Marca y modelo coincidentes", model: "Modelo coincidente",
    brand_type_attributes: "Marca, tipo y especificaciones",
    type_attributes: "Tipo y especificaciones",
    brand_attributes: "Marca y características del nombre",
  };
  return labels[method] ?? "Similitud del catálogo";
}

function ProductData({ product, store, competitorName }: { product: ReviewProduct; store: "daka" | "competitor"; competitorName: string }) {
  return <div className="review-product-panel">
    <span className={`store-label ${store === "daka" ? "daka-store" : "competitor-store"}`}>{store === "daka" ? "DAKA" : competitorName}</span>
    <h3>{product.name}</h3>
    <p>{store === "daka" ? "SAP" : "Ref."} {product.externalId}</p>
    <div className="review-product-data">{product.brand && <span>Marca: {product.brand}</span>}{product.model && <span>Modelo: {product.model}</span>}{product.category && <span>{product.category}</span>}</div>
    <strong>{product.price == null ? "Sin precio" : money.format(product.price)}</strong>
    <a href={product.url} target="_blank" rel="noreferrer">Abrir ficha {store === "daka" ? "DAKA" : competitorName} ↗</a>
  </div>;
}

export default function MatchReview({ source, competitorName, onBack, onDecision }: { source: "damasco" | "multimax" | "ivoo" | "venelectronics"; competitorName: string; onBack: () => void; onDecision: () => void }) {
  const [groups, setGroups] = useState<ReviewGroup[]>([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [totalAlternatives, setTotalAlternatives] = useState(0);
  const [safeCandidates, setSafeCandidates] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const adminKey = useRef<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async (offset = 0) => {
    setLoading(offset === 0);
    const params = new URLSearchParams({ source, search: debouncedSearch, limit: "15", offset: String(offset) });
    try {
      const response = await fetch(`/api/matches?${params.toString()}`, { cache: "no-store" });
      const page = await response.json() as ReviewPage & { error?: string };
      if (!response.ok) throw new Error(page.error ?? "No fue posible cargar los candidatos");
      setGroups((current) => offset === 0 ? page.groups : [...current, ...page.groups.filter((group) => !current.some((known) => known.daka.id === group.daka.id))]);
      setTotalProducts(page.totalProducts);
      setTotalAlternatives(page.totalAlternatives);
      setSafeCandidates(page.safeCandidates);
      setHasMore(page.hasMore);
      if (offset === 0) setSelected(new Set());
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible cargar los candidatos");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, source]);

  useEffect(() => { void load(0); }, [load]);

  function getAdminKey() {
    if (!adminKey.current) adminKey.current = window.prompt("Ingresa la clave administrativa para guardar decisiones de homologación:");
    return adminKey.current;
  }

  async function decide(matchId: number, action: "confirm" | "reject") {
    const key = getAdminKey();
    if (!key) return;
    setProcessing(true);
    setMessage(null);
    try {
      const response = await fetch("/api/matches", {
        method: "POST", headers: { "content-type": "application/json", "x-admin-key": key },
        body: JSON.stringify({ matchId, action }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) adminKey.current = null;
        throw new Error(result.error ?? "No fue posible guardar la decisión");
      }
      onDecision();
      await load(0);
      setMessage(action === "confirm" ? "Equivalencia confirmada. Ya forma parte del comparador." : "Alternativa descartada. Las demás opciones del producto se conservaron.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible guardar la decisión");
    } finally {
      setProcessing(false);
    }
  }

  function toggle(group: ReviewGroup, candidate: ReviewCandidate) {
    setSelected((current) => {
      const next = new Set(current);
      for (const option of group.candidates) next.delete(option.matchId);
      if (!current.has(candidate.matchId)) next.add(candidate.matchId);
      return next;
    });
  }

  function selectVisibleSafe() {
    const next = new Set<number>();
    for (const group of groups) {
      const safe = group.candidates.find((candidate) => candidate.bulkEligible);
      if (safe) next.add(safe.matchId);
    }
    setSelected(next);
  }

  async function confirmSelected() {
    if (!selected.size) return;
    const key = getAdminKey();
    if (!key) return;
    if (!window.confirm(`Confirmar ${selected.size} equivalencias seleccionadas como el mismo producto?`)) return;
    setProcessing(true);
    setMessage(null);
    try {
      const response = await fetch("/api/matches", {
        method: "POST", headers: { "content-type": "application/json", "x-admin-key": key },
        body: JSON.stringify({ action: "confirm_bulk", matchIds: [...selected] }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) adminKey.current = null;
        throw new Error(result.error ?? "No fue posible confirmar la selección");
      }
      onDecision();
      await load(0);
      setMessage(`${result.confirmed} equivalencias confirmadas${result.skipped ? ` · ${result.skipped} omitidas por seguridad o conflicto` : ""}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible confirmar la selección");
    } finally {
      setProcessing(false);
    }
  }

  return <section className="review-module">
    <div className="review-header"><div><span className="eyebrow-dark">Control de homologación · Motor V2.2</span><h2>Coincidencias agrupadas por producto</h2><p>Revisa un producto DAKA y elige solamente su alternativa equivalente en {competitorName}.</p></div><button className="secondary-button" onClick={onBack}>← Volver al comparador</button></div>
    <div className="review-summary">
      <div><strong>{integer.format(totalProducts)}</strong><span>productos DAKA por validar</span></div>
      <div><strong>{integer.format(totalAlternatives)}</strong><span>alternativas analizadas</span></div>
      <div><strong>{integer.format(safeCandidates)}</strong><span>primeras opciones de alta confianza</span></div>
    </div>
    <div className="review-toolbar"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por producto, SAP o referencia"/><div className="review-bulk-actions"><button type="button" onClick={selectVisibleSafe} disabled={processing || loading}>Seleccionar sugerencias visibles</button><button className="confirm-button" type="button" onClick={() => void confirmSelected()} disabled={processing || selected.size === 0}>{processing ? "Procesando…" : `Confirmar seleccionadas (${selected.size})`}</button></div></div>
    <div className="review-safety-note">La selección rápida solo se habilita para la primera opción con ≥85% de confianza, marca y tipo confirmados, modelo compartido o al menos dos especificaciones coincidentes y sin conflictos.</div>
    {message && <div className="review-message" role="status">{message}</div>}
    {loading ? <div className="empty-state">Cargando productos pendientes…</div> : groups.length === 0 ? <div className="empty-state">No existen productos pendientes con esta búsqueda.</div> : <div className="review-group-list">{groups.map((group) => <article className="review-group" key={group.daka.id}>
      <div className="review-group-daka"><div className="review-group-title"><span>Producto base</span><b>{group.candidates.length} alternativa{group.candidates.length === 1 ? "" : "s"} disponible{group.candidates.length === 1 ? "" : "s"}</b></div><ProductData product={group.daka} store="daka" competitorName={competitorName}/></div>
      <div className="review-options">{group.candidates.map((candidate, index) => <div className={`review-option ${selected.has(candidate.matchId) ? "selected" : ""}`} key={candidate.matchId}>
        <div className="review-option-head"><div><strong>Opción {index + 1}</strong><span>{(candidate.confidence * 100).toFixed(0)}% de confianza</span></div>{candidate.bulkEligible && <label className="safe-selector"><input type="checkbox" checked={selected.has(candidate.matchId)} onChange={() => toggle(group, candidate)}/> Alta confianza</label>}</div>
        <ProductData product={candidate.competitor} store="competitor" competitorName={competitorName}/>
        <div className="review-evidence"><span>Coincidencias detectadas</span><div>{candidate.evidence.brand && <b>Marca: {candidate.evidence.brand}</b>}{candidate.evidence.productType && <b>Tipo: {candidate.evidence.productType.replaceAll("_", " ")}</b>}{candidate.evidence.sharedModels?.map((value) => <b key={value}>Modelo: {value}</b>)}{candidate.evidence.sharedAttributes?.map((value) => <b key={value}>{describeAttribute(value)}</b>)}</div></div>
        <div className="review-method"><b>{methodLabel(candidate.matchMethod)}</b>{candidate.evidence.engineVersion && <span>Motor V{candidate.evidence.engineVersion}</span>}</div>
        {!!candidate.evidence.variantNotes?.length && <div className="review-variant-notes">{candidate.evidence.variantNotes.map((note) => <span key={note}>{note}. El color se informa, pero no invalida el producto base.</span>)}</div>}
        {!!candidate.evidence.warnings?.length && <div className="review-warnings"><strong>Revisión necesaria</strong>{candidate.evidence.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}
        <div className="review-actions"><button className="reject-button" disabled={processing} onClick={() => void decide(candidate.matchId, "reject")}>Descartar esta opción</button><button className="confirm-button" disabled={processing} onClick={() => void decide(candidate.matchId, "confirm")}>Confirmar equivalencia</button></div>
      </div>)}</div>
    </article>)}</div>}
    {hasMore && <div className="changes-load-more"><button onClick={() => void load(groups.length)}>Cargar 15 productos más</button></div>}
  </section>;
}
