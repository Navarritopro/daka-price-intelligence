"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const SOURCE_META = {
  damasco: { name: "Damasco", color: "#B53112" },
  multimax: { name: "Multimax", color: "#053AED" },
  ivoo: { name: "Ivoo", color: "#05A950" },
  venelectronics: { name: "Venelectronics", color: "#73A851" },
  soytechno: { name: "SoyTechno", color: "#38A9E0" }
} as const;
type Source = keyof typeof SOURCE_META;
type CompetitorProduct = { id: number; externalId: string; name: string; brand: string | null; model: string | null; category: string | null; url: string; price: number | null; inStock: boolean | null; score?: number };
type Match = { origin: "web" | "universe"; matchId: number; status: "confirmed" | "no_applicable"; reason?: string; notes?: string; product?: CompetitorProduct };
type Row = { sku: string; description: string; brand: string; line: string; family: string; subfamily: string | null; active: boolean; price: number | null; priceDate: string | null; webProductId: number | null; webUrl: string | null; matches: Partial<Record<Source, Match>> };
type Page = { items: Row[]; total: number; filters: { brands: string[]; lines: string[] }; error?: string };
type Editor = { row: Row; source: Source } | null;

const money = new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD" });
const integer = new Intl.NumberFormat("es-VE");
const PAGE_SIZE = 20;

function MatchCell({ match, source, canAdmin, onEdit }: { match?: Match; source: Source; canAdmin: boolean; onEdit: () => void }) {
  if (match?.status === "no_applicable") return <div className="universe-match-cell no-apply"><span>No aplica</span><small>{match.reason}</small>{canAdmin && <button onClick={onEdit}>Revisar</button>}</div>;
  if (match?.product) return <div className="universe-match-cell matched" style={{ borderTopColor: SOURCE_META[source].color }}><span>{match.origin === "web" ? "Homologado web" : "Homologado manual"}</span><strong>{match.product.name}</strong><small>{match.product.externalId}{match.product.brand ? ` · ${match.product.brand}` : ""}</small><div><b>{match.product.price == null ? "Sin precio" : money.format(match.product.price)}</b><a href={match.product.url} target="_blank" rel="noreferrer">Abrir ↗</a></div>{canAdmin && match.origin === "universe" && <button onClick={onEdit}>Cambiar</button>}</div>;
  return <div className="universe-match-cell pending"><span>Pendiente</span><small>Sin homologación confirmada</small>{canAdmin && <button onClick={onEdit}>Homologar</button>}</div>;
}

export default function DakaUniverseHomologations({ canAdmin }: { canAdmin: boolean }) {
  const [items, setItems] = useState<Row[]>([]); const [pageData, setPageData] = useState<Page | null>(null);
  const [search, setSearch] = useState(""); const [debouncedSearch, setDebouncedSearch] = useState("");
  const [brand, setBrand] = useState(""); const [line, setLine] = useState(""); const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor>(null); const [candidateSearch, setCandidateSearch] = useState(""); const [debouncedCandidateSearch, setDebouncedCandidateSearch] = useState("");
  const [candidates, setCandidates] = useState<CompetitorProduct[]>([]); const [selected, setSelected] = useState<CompetitorProduct | null>(null);
  const [candidateLoading, setCandidateLoading] = useState(false); const [saving, setSaving] = useState(false); const [reason, setReason] = useState(""); const [notes, setNotes] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 350); return () => window.clearTimeout(timer); }, [search]);
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedCandidateSearch(candidateSearch.trim()), 350); return () => window.clearTimeout(timer); }, [candidateSearch]);
  useEffect(() => { setPage(0); }, [brand, line, status, debouncedSearch]);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ search: debouncedSearch, brand, line, status, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      const response = await fetch(`/api/daka-universe/homologations?${params}`, { cache: "no-store", signal });
      const payload = await response.json() as Page;
      if (!response.ok) throw new Error(payload.error ?? "No fue posible cargar las homologaciones");
      setPageData(payload); setItems(payload.items);
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      setError(requestError instanceof Error ? requestError.message : "No fue posible cargar las homologaciones");
    } finally { setLoading(false); }
  }, [brand, debouncedSearch, line, page, status]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load, refresh]);

  useEffect(() => {
    if (!editor) return;
    const controller = new AbortController(); setCandidateLoading(true);
    const params = new URLSearchParams({ mode: "candidates", sku: editor.row.sku, source: editor.source, search: debouncedCandidateSearch });
    fetch(`/api/daka-universe/homologations?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "No fue posible buscar candidatos"); return payload; })
      .then((payload) => setCandidates(payload.items ?? []))
      .catch((requestError) => { if (!(requestError instanceof DOMException && requestError.name === "AbortError")) setError(requestError instanceof Error ? requestError.message : "No fue posible buscar candidatos"); })
      .finally(() => setCandidateLoading(false));
    return () => controller.abort();
  }, [debouncedCandidateSearch, editor]);

  function openEditor(row: Row, source: Source) {
    setEditor({ row, source }); setCandidateSearch(""); setSelected(null); setReason(""); setNotes(row.matches[source]?.notes ?? ""); setCandidates([]); setError(null);
  }

  async function save(action: "confirm" | "no_applicable" | "clear") {
    if (!editor || (action === "confirm" && !selected) || (action === "no_applicable" && !reason.trim())) return;
    const prompt = action === "confirm" ? `¿Confirmas la homologación manual con ${selected?.name}?` : action === "no_applicable" ? `¿Confirmas que ${SOURCE_META[editor.source].name} no aplica para este SKU?` : "¿Deseas limpiar esta decisión y dejarla pendiente?";
    if (!window.confirm(prompt)) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/daka-universe/homologations", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, sku: editor.row.sku, source: editor.source, productId: selected?.id ?? null, reason, notes }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No fue posible guardar la homologación");
      setEditor(null); setRefresh((value) => value + 1);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "No fue posible guardar la homologación"); }
    finally { setSaving(false); }
  }

  const activeFilters = useMemo(() => [search.trim(), brand, line, status !== "all" ? status : ""].filter(Boolean).length, [brand, line, search, status]);
  const pages = Math.max(1, Math.ceil((pageData?.total ?? 0) / PAGE_SIZE));
  return <section className="universe-homologations">
    <div className="universe-match-intro"><div><span className="eyebrow-dark">Comparación transversal</span><h2>Homologación competitiva</h2><p>Una vista por SKU Daka y sus cinco competidores. Las sugerencias requieren siempre confirmación manual.</p></div><div><strong>{integer.format(pageData?.total ?? 0)}</strong><span>productos encontrados</span></div></div>
    <section className="universe-filter-panel"><div className="universe-filter-head"><div><strong>Filtrar homologaciones</strong><span>{activeFilters ? `${activeFilters} filtros activos` : "Sin filtros aplicados"}</span></div><button disabled={!activeFilters} onClick={() => { setSearch(""); setDebouncedSearch(""); setBrand(""); setLine(""); setStatus("all"); }}>× Limpiar filtros</button></div><div className="universe-match-filters"><label><span>Producto</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="SKU o descripción"/></label><label><span>Marca</span><input list="universe-match-brands" value={brand} onChange={(event) => setBrand(event.target.value)} placeholder="Todas"/><datalist id="universe-match-brands">{pageData?.filters.brands.map((value) => <option key={value} value={value}/>)}</datalist></label><label><span>Línea</span><input list="universe-match-lines" value={line} onChange={(event) => setLine(event.target.value)} placeholder="Todas"/><datalist id="universe-match-lines">{pageData?.filters.lines.map((value) => <option key={value} value={value}/>)}</datalist></label><label><span>Estado</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Todos</option><option value="pending">Sin decisiones</option><option value="partial">Parcial</option><option value="complete">Completo</option><option value="no_applicable">Con “No aplica”</option></select></label></div></section>
    {error && <div className="error-banner"><strong>No se pudo completar la operación</strong><span>{error}</span><button onClick={() => setRefresh((value) => value + 1)}>Reintentar</button></div>}
    <article className="universe-match-table"><div className="table-scroll"><table><thead><tr><th>Producto Daka</th>{(Object.keys(SOURCE_META) as Source[]).map((source) => <th key={source}><span className="source-dot" style={{ background: SOURCE_META[source].color }}/>{SOURCE_META[source].name}</th>)}</tr></thead><tbody>{items.map((row) => <tr key={row.sku}><td><span className="daka-reference-label">DAKA</span><strong>{row.description}</strong><small>{row.sku} · {row.brand}</small><small>{row.line} · {row.family}</small><div className="daka-price-reference"><b>{row.price == null ? "Sin precio Daka" : money.format(row.price)}</b><span>{row.price == null ? "No se calcula brecha" : `Lista · ${row.priceDate ? new Date(row.priceDate).toLocaleDateString("es-VE", { timeZone: "UTC" }) : "vigente"}`}</span></div>{row.webUrl ? <a href={row.webUrl} target="_blank" rel="noreferrer">Disponible en web ↗</a> : <span className="not-on-web">No publicado en web</span>}</td>{(Object.keys(SOURCE_META) as Source[]).map((source) => <td key={source}><MatchCell match={row.matches[source]} source={source} canAdmin={canAdmin} onEdit={() => openEditor(row, source)}/></td>)}</tr>)}</tbody></table></div>{loading && <div className="empty-state">Consultando homologaciones…</div>}{!loading && !items.length && <div className="empty-state">No existen productos con estos filtros.</div>}<div className="management-pagination"><button disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Anterior</button><span>Página {page + 1} de {pages}</span><button disabled={page + 1 >= pages} onClick={() => setPage((value) => value + 1)}>Siguiente</button></div></article>

    {editor && <div className="universe-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEditor(null); }}><aside className="universe-drawer universe-match-drawer" role="dialog" aria-modal="true"><header><div><span className="eyebrow-dark">Homologación manual · {SOURCE_META[editor.source].name}</span><h2>{editor.row.description}</h2><small>{editor.row.sku} · {editor.row.brand}</small></div><button disabled={saving} onClick={() => setEditor(null)}>×</button></header><div className="universe-drawer-body"><div className="manual-match-rule"><strong>La sugerencia no se aprueba automáticamente</strong><span>Valida marca, modelo, capacidad, características y presentación antes de confirmar.</span></div><label className="candidate-search"><span>Buscar producto en {SOURCE_META[editor.source].name}</span><input value={candidateSearch} onChange={(event) => setCandidateSearch(event.target.value)} placeholder="Nombre, referencia, marca o modelo"/></label>{candidateLoading ? <div className="empty-state">Buscando sugerencias…</div> : <div className="universe-candidate-list">{candidates.map((candidate, index) => <button key={candidate.id} className={selected?.id === candidate.id ? "selected" : ""} onClick={() => setSelected(candidate)}><div><span>{!candidateSearch && index < 5 ? `Sugerencia ${index + 1}` : "Resultado"}{candidate.score != null ? ` · afinidad ${(candidate.score * 100).toFixed(0)}%` : ""}</span><strong>{candidate.name}</strong><small>{candidate.externalId}{candidate.brand ? ` · ${candidate.brand}` : ""}{candidate.model ? ` · ${candidate.model}` : ""}</small></div><div><b>{candidate.price == null ? "Sin precio" : money.format(candidate.price)}</b><small>{candidate.inStock === false ? "Sin disponibilidad" : "Disponible"}</small><a href={candidate.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>Abrir ↗</a></div></button>)}{!candidates.length && <div className="empty-state">No encontramos sugerencias. Escribe una referencia o modelo para ampliar la búsqueda.</div>}</div>}<label className="candidate-search"><span>Observación opcional</span><textarea maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Contexto para la auditoría"/></label><div className="manual-match-actions"><button className="primary-button" disabled={!selected || saving} onClick={() => void save("confirm")}>{saving ? "Guardando…" : "Confirmar producto seleccionado"}</button></div><section className="no-apply-section"><h3>Este competidor no aplica</h3><p>Utiliza esta opción únicamente cuando no exista un producto comparable.</p><input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={250} placeholder="Motivo obligatorio"/><button disabled={!reason.trim() || saving} onClick={() => void save("no_applicable")}>Marcar como No aplica</button></section>{editor.row.matches[editor.source]?.origin === "universe" && <button className="clear-match-button" disabled={saving} onClick={() => void save("clear")}>Limpiar decisión y dejar pendiente</button>}</div></aside></div>}
  </section>;
}
