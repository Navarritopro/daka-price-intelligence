"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

const SOURCE_META = {
  damasco: { name: "Damasco", color: "#B53112" },
  multimax: { name: "Multimax", color: "#053AED" },
  ivoo: { name: "Ivoo", color: "#05A950" },
  venelectronics: { name: "Venelectronics", color: "#73A851" },
  soytechno: { name: "SoyTechno", color: "#38A9E0" }
} as const;

type Source = keyof typeof SOURCE_META;
type SortMode = "pending_desc" | "pending_asc" | "gap_desc" | "name";
type CompetitorProduct = {
  id: number;
  externalId: string;
  name: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  url: string;
  price: number | null;
  inStock: boolean | null;
  score?: number;
  suggestionLevel?: "high" | "medium" | "exploratory";
};
type Match = {
  origin: "web" | "universe";
  matchId: number;
  status: "confirmed" | "no_applicable";
  reason?: string;
  notes?: string;
  product?: CompetitorProduct;
};
type Row = {
  sku: string;
  description: string;
  brand: string;
  line: string;
  family: string;
  subfamily: string | null;
  active: boolean;
  price: number | null;
  priceDate: string | null;
  webProductId: number | null;
  webUrl: string | null;
  matches: Partial<Record<Source, Match>>;
};
type Page = { items: Row[]; total: number; filters: { brands: string[]; lines: string[] }; error?: string };
type Editor = { row: Row; source: Source } | null;

const SOURCE_KEYS = Object.keys(SOURCE_META) as Source[];
const money = new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD" });
const integer = new Intl.NumberFormat("es-VE");
const PAGE_SIZE = 20;

async function readApiPayload<T extends { error?: string }>(response: Response, fallback: string): Promise<T> {
  const body = await response.text();
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(response.ok ? fallback : "El servicio tardó demasiado en responder. Reintente en unos segundos.");
  }
}

function decisionCount(row: Row) {
  return SOURCE_KEYS.filter((source) => Boolean(row.matches[source])).length;
}

function pricePosition(row: Row, source?: Source): "best" | "worst" | "tie" | null {
  const entries: Array<{ id: "daka" | Source; price: number }> = [];
  if (row.price != null) entries.push({ id: "daka", price: row.price });
  SOURCE_KEYS.forEach((key) => {
    const price = row.matches[key]?.product?.price;
    if (price != null) entries.push({ id: key, price });
  });
  if (entries.length < 2) return null;
  const target = entries.find((entry) => entry.id === (source ?? "daka"));
  if (!target) return null;
  const prices = entries.map((entry) => entry.price);
  const minimum = Math.min(...prices);
  const maximum = Math.max(...prices);
  if (minimum === maximum) return "tie";
  if (target.price === minimum) return "best";
  if (target.price === maximum) return "worst";
  return null;
}

function PositionBadge({ position }: { position: ReturnType<typeof pricePosition> }) {
  if (!position) return null;
  const labels = { best: "Mejor precio", worst: "Mayor precio", tie: "Precio igual" };
  return <span className={`price-position ${position}`}>{labels[position]}</span>;
}

function MatchCell({ row, match, source, canAdmin, onEdit }: { row: Row; match?: Match; source: Source; canAdmin: boolean; onEdit: () => void }) {
  if (match?.status === "no_applicable") {
    return <div className="universe-match-cell compact no-apply">
      <div className="match-status-line"><span>No aplica</span>{canAdmin && <button onClick={onEdit}>Revisar</button>}</div>
      <small title={match.reason}>{match.reason || "Sin producto comparable"}</small>
    </div>;
  }

  if (match?.product) {
    const gap = row.price == null || match.product.price == null ? null : match.product.price - row.price;
    const gapPercent = gap == null || !row.price ? null : (gap / row.price) * 100;
    return <div className="universe-match-cell compact matched" style={{ "--source-color": SOURCE_META[source].color } as CSSProperties}>
      <div className="match-status-line">
        <span>{match.origin === "web" ? "Web" : "Manual"}</span>
        <PositionBadge position={pricePosition(row, source)} />
      </div>
      <strong title={match.product.name}>{match.product.name}</strong>
      <small>{match.product.externalId}{match.product.brand ? ` · ${match.product.brand}` : ""}</small>
      <div className="match-price-line">
        <b>{match.product.price == null ? "Sin precio" : money.format(match.product.price)}</b>
        {gap != null && <span className={gap < 0 ? "favorable" : gap > 0 ? "unfavorable" : "neutral"}>
          {gap === 0 ? "Igual a Daka" : `${gap > 0 ? "+" : "−"}${money.format(Math.abs(gap))}${gapPercent == null ? "" : ` · ${Math.abs(gapPercent).toFixed(1)}%`}`}
        </span>}
      </div>
      <div className="match-cell-actions"><a href={match.product.url} target="_blank" rel="noreferrer">Abrir ↗</a>{canAdmin && <button onClick={onEdit}>{match.origin === "web" ? "Ver" : "Cambiar"}</button>}</div>
    </div>;
  }

  return <div className="universe-match-cell compact pending">
    <div className="match-status-line"><span>Pendiente</span></div>
    <small>Sin homologación</small>
    {canAdmin && <button onClick={onEdit}>Homologar</button>}
  </div>;
}

export default function DakaUniverseHomologations({ canAdmin }: { canAdmin: boolean }) {
  const [items, setItems] = useState<Row[]>([]);
  const [pageData, setPageData] = useState<Page | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [brand, setBrand] = useState("");
  const [line, setLine] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<SortMode>("pending_desc");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [debouncedCandidateSearch, setDebouncedCandidateSearch] = useState("");
  const [candidates, setCandidates] = useState<CompetitorProduct[]>([]);
  const [selected, setSelected] = useState<CompetitorProduct | null>(null);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateCatalogSize, setCandidateCatalogSize] = useState(0);
  const [automaticSuggestions, setAutomaticSuggestions] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [refresh, setRefresh] = useState(0);
  const tableScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedCandidateSearch(candidateSearch.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [candidateSearch]);
  useEffect(() => { setPage(0); }, [brand, line, status, sort, debouncedSearch]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ search: debouncedSearch, brand, line, status, sort, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      const response = await fetch(`/api/daka-universe/homologations?${params}`, { cache: "no-store", signal });
      const payload = await readApiPayload<Page>(response, "La respuesta de homologaciones no fue válida");
      if (!response.ok) throw new Error(payload.error ?? "No fue posible cargar las homologaciones");
      setPageData(payload);
      setItems(payload.items);
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      setError(requestError instanceof Error ? requestError.message : "No fue posible cargar las homologaciones");
    } finally {
      setLoading(false);
    }
  }, [brand, debouncedSearch, line, page, sort, status]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refresh]);

  const currentMatch = editor ? editor.row.matches[editor.source] : undefined;
  const editorIsReadOnly = currentMatch?.origin === "web" && currentMatch.status === "confirmed";

  useEffect(() => {
    if (!editor || editorIsReadOnly) return;
    const controller = new AbortController();
    setCandidateLoading(true);
    const params = new URLSearchParams({ mode: "candidates", sku: editor.row.sku, source: editor.source, search: debouncedCandidateSearch });
    fetch(`/api/daka-universe/homologations?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await readApiPayload<{ items?: CompetitorProduct[]; catalogSize?: number; automatic?: boolean; error?: string }>(response, "La respuesta de candidatos no fue válida");
        if (!response.ok) throw new Error(payload.error ?? "No fue posible buscar candidatos");
        return payload;
      })
      .then((payload) => {
        setCandidates(payload.items ?? []);
        setCandidateCatalogSize(Number(payload.catalogSize ?? 0));
        setAutomaticSuggestions(Boolean(payload.automatic));
      })
      .catch((requestError) => {
        if (!(requestError instanceof DOMException && requestError.name === "AbortError")) {
          setError(requestError instanceof Error ? requestError.message : "No fue posible buscar candidatos");
        }
      })
      .finally(() => setCandidateLoading(false));
    return () => controller.abort();
  }, [debouncedCandidateSearch, editor, editorIsReadOnly]);

  function resetEditorForm(row: Row, source: Source) {
    setEditor({ row, source });
    setCandidateSearch("");
    setSelected(null);
    setReason(row.matches[source]?.reason ?? "");
    setNotes(row.matches[source]?.notes ?? "");
    setCandidates([]);
    setCandidateCatalogSize(0);
    setAutomaticSuggestions(true);
    setError(null);
  }

  function openEditor(row: Row, source?: Source) {
    const firstPending = SOURCE_KEYS.find((key) => !row.matches[key]);
    resetEditorForm(row, source ?? firstPending ?? SOURCE_KEYS[0]);
  }

  function updateLocalMatch(sku: string, source: Source, match?: Match) {
    const update = (rows: Row[]) => rows.map((row) => row.sku === sku ? { ...row, matches: { ...row.matches, [source]: match } } : row);
    setItems(update);
    setEditor((value) => value?.row.sku === sku ? { ...value, row: update([value.row])[0] } : value);
  }

  async function save(action: "confirm" | "no_applicable" | "clear") {
    if (!editor || (action === "confirm" && !selected) || (action === "no_applicable" && !reason.trim())) return;
    const prompt = action === "confirm"
      ? `¿Confirmas la homologación manual con ${selected?.name}?`
      : action === "no_applicable"
        ? `¿Confirmas que ${SOURCE_META[editor.source].name} no aplica para este SKU?`
        : "¿Deseas limpiar esta decisión y dejarla pendiente?";
    if (!window.confirm(prompt)) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/daka-universe/homologations", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, sku: editor.row.sku, source: editor.source, productId: selected?.id ?? null, reason, notes })
      });
      const payload = await readApiPayload<{ matchId?: number; error?: string }>(response, "La respuesta al guardar la homologación no fue válida");
      if (!response.ok) throw new Error(payload.error ?? "No fue posible guardar la homologación");

      const savedMatch: Match | undefined = action === "clear" ? undefined : {
        origin: "universe",
        matchId: Number(payload.matchId ?? currentMatch?.matchId ?? 0),
        status: action === "confirm" ? "confirmed" : "no_applicable",
        reason: action === "no_applicable" ? reason.trim() : undefined,
        notes: notes.trim() || undefined,
        product: action === "confirm" ? selected ?? undefined : undefined
      };
      const sku = editor.row.sku;
      const source = editor.source;
      updateLocalMatch(sku, source, savedMatch);

      if (action !== "clear") {
        const latestRow = { ...editor.row, matches: { ...editor.row.matches, [source]: savedMatch } };
        const nextPending = SOURCE_KEYS.find((key) => !latestRow.matches[key]);
        if (nextPending) resetEditorForm(latestRow, nextPending);
        else setEditor({ row: latestRow, source });
      } else {
        const latestRow = { ...editor.row, matches: { ...editor.row.matches, [source]: undefined } };
        resetEditorForm(latestRow, source);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible guardar la homologación");
    } finally {
      setSaving(false);
    }
  }

  const visibleItems = items;

  const activeFilters = useMemo(() => [search.trim(), brand, line, status !== "all" ? status : ""].filter(Boolean).length, [brand, line, search, status]);
  const pages = Math.max(1, Math.ceil((pageData?.total ?? 0) / PAGE_SIZE));
  const uniformDecisionProgress = visibleItems.length > 1 && visibleItems.every((row) => decisionCount(row) === decisionCount(visibleItems[0]));
  const candidateHints = useMemo(() => {
    if (!editor) return [];
    const possibleModel = editor.row.description.toUpperCase().split(/[^A-Z0-9-]+/).find((token) => token.length >= 6 && /[A-Z]/.test(token) && /\d/.test(token));
    return [...new Set([possibleModel, editor.row.brand].filter((value): value is string => Boolean(value)))].slice(0, 2);
  }, [editor]);

  return <section className="universe-homologations">
    <div className="universe-match-intro">
      <div><span className="eyebrow-dark">Comparación transversal</span><h2>Homologación competitiva</h2><p>Compare cada SKU Daka con los cinco competidores, detecte brechas y gestione todas las decisiones desde un solo lugar.</p></div>
      <div><strong>{integer.format(pageData?.total ?? 0)}</strong><span>productos encontrados</span></div>
    </div>

    <section className="universe-filter-panel">
      <div className="universe-filter-head"><div><strong>Filtrar homologaciones</strong><span>{activeFilters ? `${activeFilters} filtros activos` : "Sin filtros aplicados"}</span></div><button disabled={!activeFilters} onClick={() => { setSearch(""); setDebouncedSearch(""); setBrand(""); setLine(""); setStatus("all"); }}>× Limpiar filtros</button></div>
      <div className="universe-match-filters">
        <label><span>Producto</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="SKU o descripción" /></label>
        <label><span>Marca</span><input list="universe-match-brands" value={brand} onChange={(event) => setBrand(event.target.value)} placeholder="Todas" /><datalist id="universe-match-brands">{pageData?.filters.brands.map((value) => <option key={value} value={value} />)}</datalist></label>
        <label><span>Línea</span><input list="universe-match-lines" value={line} onChange={(event) => setLine(event.target.value)} placeholder="Todas" /><datalist id="universe-match-lines">{pageData?.filters.lines.map((value) => <option key={value} value={value} />)}</datalist></label>
        <label><span>Estado</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Todos</option><option value="pending">Sin decisiones</option><option value="partial">Parcial</option><option value="complete">Completo</option><option value="no_applicable">Con “No aplica”</option></select></label>
      </div>
    </section>

    {error && <div className="error-banner"><strong>No se pudo completar la operación</strong><span>{error}</span><button onClick={() => setRefresh((value) => value + 1)}>Reintentar</button></div>}

    <article className="universe-match-table compact-matrix">
      <div className="matrix-toolbar">
        <div><strong>Vista comparativa</strong><span>Los cinco competidores permanecen en la misma fila del producto Daka.</span></div>
        <label><span>Ordenar todos los resultados</span><select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="pending_desc">Más pendientes primero</option><option value="pending_asc">Más completos primero</option><option value="gap_desc">Mayor brecha absoluta</option><option value="name">Nombre A–Z</option></select>{uniformDecisionProgress && (sort === "pending_desc" || sort === "pending_asc") && <small>Estos resultados tienen el mismo avance; por eso mantienen su orden alfabético.</small>}</label>
        <div className="matrix-scroll-controls" aria-label="Desplazar comparación"><button type="button" title="Mover a la izquierda" onClick={() => tableScrollRef.current?.scrollBy({ left: -420, behavior: "smooth" })}>←</button><button type="button" title="Mover a la derecha" onClick={() => tableScrollRef.current?.scrollBy({ left: 420, behavior: "smooth" })}>→</button></div>
      </div>
      <div className="table-scroll matrix-scroll" ref={tableScrollRef}>
        <table>
          <colgroup><col className="daka-column" />{SOURCE_KEYS.map((source) => <col className="competitor-column" key={source} />)}</colgroup>
          <thead><tr><th><div className="matrix-source-head daka"><span>DAKA</span><small>Producto base</small></div></th>{SOURCE_KEYS.map((source) => <th key={source}><div className="matrix-source-head"><span><i className="source-dot" style={{ background: SOURCE_META[source].color }} />{SOURCE_META[source].name}</span><small>{visibleItems.filter((row) => row.matches[source]).length}/{visibleItems.length} definidos</small></div></th>)}</tr></thead>
          <tbody>{visibleItems.map((row) => {
            const completed = decisionCount(row);
            return <tr key={row.sku}>
              <td>
                <div className="daka-cell-heading"><span className="daka-reference-label">DAKA</span><PositionBadge position={pricePosition(row)} /></div>
                <strong title={row.description}>{row.description}</strong>
                <small>{row.sku} · {row.brand}</small><small>{row.line} · {row.family}</small>
                <div className="daka-price-reference"><b>{row.price == null ? "Sin precio Daka" : money.format(row.price)}</b><span>{row.price == null ? "No se calcula brecha" : `Lista · ${row.priceDate ? new Date(row.priceDate).toLocaleDateString("es-VE", { timeZone: "UTC" }) : "vigente"}`}</span></div>
                <div className="match-progress-label"><span>{completed}/5 definidos</span><b>{completed === 5 ? "Completo" : `${5 - completed} pendientes`}</b></div>
                <div className="match-progress" aria-label={`${completed} de 5 competidores definidos`}><span style={{ width: `${completed * 20}%` }} /></div>
                <div className="daka-cell-footer">{row.webUrl ? <a href={row.webUrl} target="_blank" rel="noreferrer">Ver en web ↗</a> : <span className="not-on-web">No publicado en web</span>}{canAdmin && <button onClick={() => openEditor(row)}>Gestionar</button>}</div>
              </td>
              {SOURCE_KEYS.map((source) => <td key={source}><MatchCell row={row} match={row.matches[source]} source={source} canAdmin={canAdmin} onEdit={() => openEditor(row, source)} /></td>)}
            </tr>;
          })}</tbody>
        </table>
      </div>
      {loading && <div className="empty-state">Consultando homologaciones…</div>}
      {!loading && !items.length && <div className="empty-state">No existen productos con estos filtros.</div>}
      <div className="management-pagination"><button disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Anterior</button><span>Página {page + 1} de {pages}</span><button disabled={page + 1 >= pages} onClick={() => setPage((value) => value + 1)}>Siguiente</button></div>
    </article>

    {editor && <div className="universe-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEditor(null); }}>
      <aside className="universe-drawer universe-match-drawer centralized" role="dialog" aria-modal="true" aria-label={`Gestionar homologaciones de ${editor.row.description}`}>
        <header><div><span className="eyebrow-dark">Gestión competitiva · {decisionCount(editor.row)}/5 definidos</span><h2>{editor.row.description}</h2><small>{editor.row.sku} · {editor.row.brand} · Precio Daka {editor.row.price == null ? "no disponible" : money.format(editor.row.price)}</small></div><button aria-label="Cerrar" disabled={saving} onClick={() => setEditor(null)}>×</button></header>
        <nav className="match-source-tabs" aria-label="Competidores">{SOURCE_KEYS.map((source) => {
          const match = editor.row.matches[source];
          return <button key={source} className={editor.source === source ? "active" : ""} style={{ "--source-color": SOURCE_META[source].color } as CSSProperties} onClick={() => resetEditorForm(editor.row, source)}><span>{SOURCE_META[source].name}</span><small>{match?.status === "no_applicable" ? "No aplica" : match?.product ? "Definido" : "Pendiente"}</small></button>;
        })}</nav>
        <div className="universe-drawer-body">
          <div className="drawer-competitor-title"><span className="source-dot" style={{ background: SOURCE_META[editor.source].color }} /><div><strong>{SOURCE_META[editor.source].name}</strong><small>{currentMatch?.status === "no_applicable" ? "Marcado como No aplica" : currentMatch?.product ? "Producto homologado" : "Seleccione un producto comparable"}</small></div></div>

          {editorIsReadOnly && currentMatch?.product ? <section className="web-match-readonly">
            <span>Homologación proveniente del catálogo web</span><strong>{currentMatch.product.name}</strong><small>{currentMatch.product.externalId}{currentMatch.product.brand ? ` · ${currentMatch.product.brand}` : ""}</small><div><b>{currentMatch.product.price == null ? "Sin precio" : money.format(currentMatch.product.price)}</b><a href={currentMatch.product.url} target="_blank" rel="noreferrer">Abrir producto ↗</a></div><p>Esta relación se administra desde el módulo de homologaciones web para conservar una única fuente de verdad.</p>
          </section> : <>
            <div className="manual-match-rule"><strong>Confirmación manual obligatoria</strong><span>Las sugerencias ayudan a buscar; el sistema nunca confirma automáticamente.</span></div>
            <label className="candidate-search"><span>Buscar en {SOURCE_META[editor.source].name}</span><input value={candidateSearch} onChange={(event) => setCandidateSearch(event.target.value)} placeholder="Nombre, referencia, marca o modelo" /><small>Puede escribir varias palabras en cualquier orden; no necesita usar el nombre exacto.</small></label>
            <div className="candidate-search-shortcuts"><span>Búsquedas rápidas:</span>{candidateHints.map((hint) => <button type="button" key={hint} onClick={() => setCandidateSearch(hint)}>{hint}</button>)}{candidateSearch && <button type="button" className="automatic" onClick={() => setCandidateSearch("")}>Ver sugerencias automáticas</button>}</div>
            {candidateLoading ? <div className="candidate-loading"><span />Analizando el catálogo de {SOURCE_META[editor.source].name}…</div> : <>
              <div className="candidate-results-head"><div><strong>{automaticSuggestions ? "Sugerencias automáticas" : "Resultados de búsqueda"}</strong><span>{candidates.length ? `${candidates.length} opciones para revisar` : "Sin coincidencias"}</span></div>{automaticSuggestions && <small>Analizadas sobre {integer.format(candidateCatalogSize)} referencias activas</small>}</div>
              <div className="candidate-results-grid">{candidates.map((candidate) => {
                const labels = { high: "Alta coincidencia", medium: "Coincidencia media", exploratory: "Revisar coincidencia" };
                const level = candidate.suggestionLevel ?? "exploratory";
                const isSelected = selected?.id === candidate.id;
                return <article key={candidate.id} className={isSelected ? "selected" : ""}>
                  <div className="candidate-card-identity"><span className={`suggestion-strength ${level}`}>{labels[level]}</span><strong>{candidate.name}</strong><span>{candidate.externalId} · {candidate.brand || "Sin marca"}{candidate.model ? ` · ${candidate.model}` : ""}</span><small>{candidate.category || "Sin categoría"}{candidate.score != null ? ` · Similitud ${Math.round(candidate.score * 100)}%` : ""}</small></div>
                  <div className="candidate-card-actions"><b>{candidate.price == null ? "Sin precio" : money.format(candidate.price)}</b><small className={candidate.inStock === false ? "unavailable" : "available"}>{candidate.inStock === false ? "Sin disponibilidad" : "Disponible"}</small><a href={candidate.url} target="_blank" rel="noreferrer">Abrir producto ↗</a><button type="button" className={isSelected ? "selected" : ""} onClick={() => setSelected(candidate)}>{isSelected ? "✓ Seleccionado" : "Seleccionar"}</button></div>
                </article>;
              })}{!candidates.length && <div className="candidate-empty"><strong>{automaticSuggestions ? "No encontramos una sugerencia confiable" : "No encontramos productos con esa búsqueda"}</strong><span>{automaticSuggestions ? "Use el modelo, la referencia, la marca o una parte del nombre. La homologación seguirá siendo manual." : "Pruebe una palabra más corta, el modelo o la referencia exacta del competidor."}</span><div>{candidateHints.map((hint) => <button type="button" key={hint} onClick={() => setCandidateSearch(hint)}>Buscar “{hint}”</button>)}{!automaticSuggestions && <button type="button" onClick={() => setCandidateSearch("")}>Volver a sugerencias</button>}</div></div>}</div>
            </>}
            <label className="candidate-search"><span>Observación opcional</span><textarea maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Contexto para la auditoría" /></label>
            <div className="manual-match-actions"><button className="primary-button" disabled={!selected || saving} onClick={() => void save("confirm")}>{saving ? "Guardando…" : "Confirmar producto seleccionado"}</button></div>
            <section className="no-apply-section"><h3>Este competidor no aplica</h3><p>Utilice esta opción únicamente cuando no exista un producto comparable.</p><input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={250} placeholder="Motivo obligatorio" /><button disabled={!reason.trim() || saving} onClick={() => void save("no_applicable")}>Marcar como No aplica</button></section>
            {currentMatch?.origin === "universe" && <button className="clear-match-button" disabled={saving} onClick={() => void save("clear")}>Limpiar decisión y dejar pendiente</button>}
          </>}
        </div>
      </aside>
    </div>}
  </section>;
}
