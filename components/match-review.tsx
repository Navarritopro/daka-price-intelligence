"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ReviewProduct = { id: number; externalId: string; name: string; url: string; price: number | null; inStock: boolean | null; brand?: string | null };
type Evidence = { brand?: string; productType?: string; sharedModels?: string[]; sharedAttributes?: string[]; tokenSimilarity?: number; nameSimilarity?: number };
type ReviewItem = { matchId: number; confidence: number; matchMethod: string; evidence: Evidence; daka: ReviewProduct; competitor: ReviewProduct };
type ReviewPage = { items: ReviewItem[]; total: number; hasMore: boolean };

const money = new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD" });
const integer = new Intl.NumberFormat("es-VE");

function describeAttribute(value: string) {
  if (value.startsWith("tech:")) return value.slice(5);
  const [number, unit] = value.split(":");
  return `${number} ${unit?.toUpperCase() ?? ""}`.trim();
}

export default function MatchReview({ onBack, onDecision }: { onBack: () => void; onDecision: () => void }) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const adminKey = useRef<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async (offset = 0) => {
    setLoading(offset === 0);
    const params = new URLSearchParams({ search: debouncedSearch, limit: "25", offset: String(offset) });
    try {
      const response = await fetch(`/api/matches?${params.toString()}`, { cache: "no-store" });
      const page = await response.json() as ReviewPage & { error?: string };
      if (!response.ok) throw new Error(page.error ?? "No fue posible cargar los candidatos");
      setItems((current) => offset === 0 ? page.items : [...current, ...page.items.filter((item) => !current.some((known) => known.matchId === item.matchId))]);
      setTotal(page.total);
      setHasMore(page.hasMore);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible cargar los candidatos");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => { void load(0); }, [load]);

  async function decide(item: ReviewItem, action: "confirm" | "reject") {
    if (!adminKey.current) {
      adminKey.current = window.prompt("Ingresa la clave administrativa para guardar decisiones de homologación:");
    }
    if (!adminKey.current) return;
    setProcessing(item.matchId);
    setMessage(null);
    try {
      const response = await fetch("/api/matches", {
        method: "POST", headers: { "content-type": "application/json", "x-admin-key": adminKey.current },
        body: JSON.stringify({ matchId: item.matchId, action })
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) adminKey.current = null;
        throw new Error(result.error ?? "No fue posible guardar la decisión");
      }
      onDecision();
      await load(0);
      setMessage(action === "confirm" ? "Equivalencia confirmada. Ya forma parte del comparador." : "Candidato rechazado. No volverá a sugerirse.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible guardar la decisión");
    } finally {
      setProcessing(null);
    }
  }

  return <section className="review-module">
    <div className="review-header"><div><span className="eyebrow-dark">Control de homologación</span><h2>Coincidencias por validar</h2><p>Confirma únicamente cuando ambos registros correspondan exactamente al mismo producto.</p></div><button className="secondary-button" onClick={onBack}>← Volver al comparador</button></div>
    <div className="review-toolbar"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por producto, SAP o referencia"/><span>{loading ? "Consultando…" : `${integer.format(total)} candidatos pendientes`}</span></div>
    {message && <div className="review-message" role="status">{message}</div>}
    {loading ? <div className="empty-state">Cargando candidatos de homologación…</div> : items.length === 0 ? <div className="empty-state">No existen candidatos pendientes con esta búsqueda.</div> : <div className="review-list">{items.map((item) => <article className="review-card" key={item.matchId}>
      <div className="review-confidence"><strong>{(item.confidence * 100).toFixed(0)}%</strong><span>confianza estimada</span></div>
      <div className="review-products"><div><span className="store-label daka-store">DAKA</span><h3>{item.daka.name}</h3><p>SAP {item.daka.externalId}</p><strong>{item.daka.price == null ? "Sin precio" : money.format(item.daka.price)}</strong><a href={item.daka.url} target="_blank" rel="noreferrer">Abrir ficha DAKA ↗</a></div><div><span className="store-label damasco-store">Damasco</span><h3>{item.competitor.name}</h3><p>Ref. {item.competitor.externalId}</p><strong>{item.competitor.price == null ? "Sin precio" : money.format(item.competitor.price)}</strong><a href={item.competitor.url} target="_blank" rel="noreferrer">Abrir ficha Damasco ↗</a></div></div>
      <div className="review-evidence"><span>Coincidencias detectadas</span><div>{item.evidence.brand && <b>Marca: {item.evidence.brand}</b>}{item.evidence.productType && <b>Tipo: {item.evidence.productType.replaceAll("_", " ")}</b>}{item.evidence.sharedModels?.map((value) => <b key={value}>Modelo: {value}</b>)}{item.evidence.sharedAttributes?.map((value) => <b key={value}>{describeAttribute(value)}</b>)}</div></div>
      <div className="review-actions"><button className="reject-button" disabled={processing !== null} onClick={() => void decide(item, "reject")}>No son equivalentes</button><button className="confirm-button" disabled={processing !== null} onClick={() => void decide(item, "confirm")}>{processing === item.matchId ? "Guardando…" : "Confirmar equivalencia"}</button></div>
    </article>)}</div>}
    {hasMore && <div className="changes-load-more"><button onClick={() => void load(items.length)}>Cargar 25 candidatos más</button></div>}
  </section>;
}
