"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Card = { periodMonth: string; raw: string; companyAbc: string; lineAbc: string; familyAbc: string; gmroi: number; xyz: string; rotation: string; coverage: string; affectation: string; warning: boolean };
type Product = {
  sku: string; line: string; family: string; subfamily: string | null; brand: string; description: string;
  masterPresent: boolean; active: boolean; card: Card | null;
  inventory: { effectiveDate: string | null; hasRecord: boolean; totalRaw: number | null; totalAvailable: number | null; cddRaw: number | null; storesRaw: number | null };
  webProductId: number | null; webUrl: string | null;
};
type Page = {
  items: Product[]; total: number; hasMore: boolean;
  stats: { total: number; masterCount: number; pendingCard: number; inactive: number; available: number; absentInventory: number; availableUnits: number };
  filters: { lines: string[]; families: string[]; subfamilies: string[]; brands: string[] }; error?: string;
};
type Detail = { product: Pick<Product, "sku" | "line" | "family" | "subfamily" | "brand" | "description" | "masterPresent" | "active">; cards: Card[]; inventory: { effectiveDate: string | null; locations: Array<{ name: string; type: "cdd" | "store"; quantityRaw: number; quantityAvailable: number }> }; error?: string };
type Preview = { kind: "master" | "inventory"; filename: string; rowCount: number; uniqueSkus: number; warnings: string[]; stats: Record<string, number>; sample: Array<Record<string, string | number | boolean>> };
type Tab = "master" | "inventory" | "locations" | "quality";
type ImportNotice = { tone: "success" | "error" | "info"; message: string };

const integer = new Intl.NumberFormat("es-VE", { maximumFractionDigits: 2 });
const day = new Intl.DateTimeFormat("es-VE", { timeZone: "UTC", day: "2-digit", month: "long", year: "numeric" });
const BATCH = 50;

const cardMeaning: Record<string, string> = {
  A: "Alta contribución", B: "Contribución media", C: "Baja contribución",
  X: "Demanda estable", Y: "Variabilidad media", Z: "Demanda irregular",
  R: "Rotación alta", E: "Rotación media", L: "Rotación baja",
  S: "Cobertura saludable", O: "Cobertura intermedia", D: "Cobertura crítica",
  P: "Afectación positiva", T: "Afectación transitoria", F: "Afectación desfavorable",
  N: "Producto nuevo, sin histórico suficiente o con pocas ventas para realizar una clasificación representativa"
};

function inventoryLabel(product: Product) {
  if (!product.inventory.hasRecord) return "Sin registro en inventario";
  if ((product.inventory.totalRaw ?? 0) < 0) return "Inventario negativo";
  if ((product.inventory.totalRaw ?? 0) === 0) return "Inventario en cero";
  return "Disponible";
}

function SearchableFilter({ id, label, placeholder, value, options, onChange }: {
  id: string; label: string; placeholder: string; value: string; options: string[]; onChange: (value: string) => void;
}) {
  return <label className="universe-filter-field" htmlFor={id}>
    <span>{label}</span>
    <input id={id} list={`${id}-options`} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete="off" />
    <datalist id={`${id}-options`}>{options.map((option) => <option key={option} value={option} />)}</datalist>
  </label>;
}

export default function DakaProductUniverse({ canAdmin }: { canAdmin: boolean }) {
  const [tab, setTab] = useState<Tab>("master");
  const [items, setItems] = useState<Product[]>([]);
  const [page, setPage] = useState<Page | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [line, setLine] = useState(""); const [family, setFamily] = useState("");
  const [subfamily, setSubfamily] = useState(""); const [brand, setBrand] = useState("");
  const [status, setStatus] = useState("all"); const [inventory, setInventory] = useState("all");
  const [loading, setLoading] = useState(true); const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null); const [selected, setSelected] = useState<Product | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null); const [detailLoading, setDetailLoading] = useState(false);
  const [importKind, setImportKind] = useState<"master" | "inventory">("master");
  const [file, setFile] = useState<File | null>(null); const [preview, setPreview] = useState<Preview | null>(null);
  const [importBusy, setImportBusy] = useState(false); const [importNotice, setImportNotice] = useState<ImportNotice | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 350); return () => window.clearTimeout(timer); }, [search]);
  const query = useCallback((offset: number) => new URLSearchParams({ search: debouncedSearch, line, family, subfamily, brand, status, inventory, offset: String(offset), limit: String(BATCH) }), [brand, debouncedSearch, family, inventory, line, status, subfamily]);
  const load = useCallback(async () => {
    setLoading(true); setError(null); setItems([]);
    try {
      const response = await fetch(`/api/daka-universe?${query(0)}`, { cache: "no-store" });
      const payload = await response.json() as Page;
      if (!response.ok) throw new Error(payload.error ?? "No fue posible cargar el universo Daka");
      setPage(payload); setItems(payload.items);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "No fue posible cargar el módulo"); }
    finally { setLoading(false); }
  }, [query]);
  useEffect(() => { void load(); }, [load]);

  const loadMore = async () => {
    if (!page?.hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(`/api/daka-universe?${query(items.length)}`, { cache: "no-store" });
      const payload = await response.json() as Page;
      if (!response.ok) throw new Error(payload.error);
      setItems((current) => [...current, ...payload.items]); setPage(payload);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "No fue posible cargar más productos"); }
    finally { setLoadingMore(false); }
  };

  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    setDetailLoading(true);
    fetch(`/api/daka-universe/${encodeURIComponent(selected.sku)}`, { cache: "no-store" })
      .then(async (response) => { const payload = await response.json() as Detail; if (!response.ok) throw new Error(payload.error); return payload; })
      .then(setDetail).catch((requestError) => setError(requestError instanceof Error ? requestError.message : "No fue posible cargar el detalle"))
      .finally(() => setDetailLoading(false));
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    document.addEventListener("keydown", close); document.body.style.overflow = "hidden";
    window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => { document.removeEventListener("keydown", close); document.body.style.overflow = ""; };
  }, [selected]);

  const visibleLocations = useMemo(() => detail?.inventory.locations ?? [], [detail]);
  const activeFilterCount = useMemo(() => [search.trim(), line, family, subfamily, brand, status !== "all" ? status : "", inventory !== "all" ? inventory : ""].filter(Boolean).length, [brand, family, inventory, line, search, status, subfamily]);

  function clearFilters() {
    setSearch(""); setDebouncedSearch(""); setLine(""); setFamily(""); setSubfamily(""); setBrand(""); setStatus("all"); setInventory("all");
  }

  function resetImportSelection() {
    setFile(null); setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function importFile(mode: "preview" | "publish") {
    if (!file) { setImportNotice({ tone: "info", message: "Selecciona el archivo Excel correspondiente." }); return; }
    setImportBusy(true); setImportNotice(null);
    try {
      const response = await fetch("/api/daka-universe/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "x-import-kind": importKind,
          "x-import-mode": mode,
          "x-file-name": encodeURIComponent(file.name)
        },
        body: file
      });
      const rawResponse = await response.text();
      let payload: { preview?: Preview; error?: string; published?: boolean } = {};
      if (rawResponse) {
        try { payload = JSON.parse(rawResponse) as typeof payload; }
        catch { throw new Error(`El servidor respondió en un formato no válido (HTTP ${response.status}).`); }
      }
      if (!rawResponse) throw new Error(`El servidor no devolvió respuesta (HTTP ${response.status}). Revisa los registros del despliegue en Vercel.`);
      if (!response.ok) throw new Error(payload.error ?? "No fue posible procesar el archivo");
      setPreview(payload.preview ?? null);
      if (payload.published) {
        const publishedName = file.name;
        resetImportSelection();
        setImportNotice({ tone: "success", message: `${publishedName} se publicó correctamente. El módulo ya utiliza esta versión.` });
        await load();
      }
    } catch (requestError) { setImportNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "No fue posible procesar el archivo" }); }
    finally { setImportBusy(false); }
  }

  return <section className="daka-universe" data-tour="daka-universe">
    <header className="universe-head"><div><span className="eyebrow-dark">Universo corporativo · independiente del scraping</span><h1>Universo de Productos Daka</h1><p>Maestro de SKU, cédula comercial e inventario del CDD y las tiendas, con trazabilidad de cada archivo publicado.</p></div><div className="universe-date"><span>Inventario vigente</span><strong>12 de octubre de 2026</strong><small>CDD = Centro de Distribución</small></div></header>
    <div className="universe-tabs" role="tablist">
      <button className={tab === "master" ? "active" : ""} onClick={() => setTab("master")}>Maestro y cédula</button>
      <button className={tab === "inventory" ? "active" : ""} onClick={() => setTab("inventory")}>Inventario consolidado</button>
      <button className={tab === "locations" ? "active" : ""} onClick={() => setTab("locations")}>Inventario por ubicación</button>
      <button className={tab === "quality" ? "active" : ""} onClick={() => setTab("quality")}>Calidad y carga</button>
    </div>

    {page && <div className="universe-stats"><article><span>Universo total</span><strong>{integer.format(page.stats.total)}</strong><small>{integer.format(page.stats.masterCount)} con cédula</small></article><article><span>Con disponibilidad</span><strong>{integer.format(page.stats.available)}</strong><small>{integer.format(page.stats.availableUnits)} unidades útiles</small></article><article><span>Sin registro de inventario</span><strong>{integer.format(page.stats.absentInventory)}</strong><small>No equivale a inventario cero</small></article><article><span>Pendientes de cédula</span><strong>{integer.format(page.stats.pendingCard)}</strong><small>Presentes solo en inventario</small></article></div>}

    {tab === "quality" ? <div className="universe-quality">
      <article><h2>Reglas de calidad aplicadas</h2><ul><li>El SKU es la identidad única; las descripciones repetidas no se fusionan.</li><li>Familia se interpreta junto con Línea para evitar cruces entre familias homónimas.</li><li>Los valores negativos se conservan exactamente y solo se consideran 0 para disponibilidad comercial.</li><li>Un SKU sin fila en el inventario se diferencia explícitamente de un SKU con inventario 0.</li><li>La cédula y cada inventario conservan período, fecha, archivo, checksum y usuario responsable.</li></ul></article>
      {canAdmin ? <article className="universe-import"><h2>Publicar archivos aprobados</h2><p className="import-help">Selecciona el tipo y valida el Excel antes de publicar. Al completar la publicación, el formulario se limpiará automáticamente.</p><div className="import-controls"><select aria-label="Tipo de archivo" value={importKind} onChange={(event) => { setImportKind(event.target.value as "master" | "inventory"); resetImportSelection(); setImportNotice(null); }}><option value="master">Maestro de SKU · octubre 2026</option><option value="inventory">Inventario · 12/10/2026</option></select><input ref={fileInputRef} aria-label="Archivo Excel" type="file" accept=".xlsx" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); setImportNotice(null); }}/><button onClick={() => void importFile("preview")} disabled={!file || importBusy}>{importBusy ? "Validando…" : "Validar y previsualizar"}</button></div>{importNotice && <div className={`import-notice ${importNotice.tone}`} role={importNotice.tone === "error" ? "alert" : "status"}><span aria-hidden="true">{importNotice.tone === "success" ? "✓" : importNotice.tone === "error" ? "!" : "i"}</span><p>{importNotice.message}</p><button aria-label="Cerrar aviso" onClick={() => setImportNotice(null)}>×</button></div>}{preview && <div className="import-preview"><div><strong>{integer.format(preview.uniqueSkus)} SKU</strong><span>{integer.format(preview.rowCount)} filas válidas</span></div>{preview.warnings.map((warning) => <p key={warning}>⚠ {warning}</p>)}<button className="primary-button" onClick={() => void importFile("publish")} disabled={importBusy}>{importBusy ? "Publicando…" : "Publicar versión validada"}</button></div>}</article> : <article><h2>Carga restringida</h2><p>Solo los administradores pueden validar y publicar archivos. Todos los usuarios autorizados pueden consultar la información.</p></article>}
    </div> : <>
      <section className="universe-filter-panel" aria-label="Filtros del universo Daka"><div className="universe-filter-head"><div><strong>Filtrar productos</strong><span>{activeFilterCount ? `${activeFilterCount} ${activeFilterCount === 1 ? "filtro activo" : "filtros activos"}` : "Sin filtros aplicados"}</span></div><button type="button" onClick={clearFilters} disabled={!activeFilterCount}>× Limpiar filtros</button></div><div className="universe-filters"><label className="universe-filter-field universe-search" htmlFor="universe-search"><span>Producto</span><input id="universe-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="SKU o descripción"/></label><SearchableFilter id="universe-line" label="Línea" placeholder="Todas las líneas" value={line} options={page?.filters.lines ?? []} onChange={setLine}/><SearchableFilter id="universe-family" label="Familia" placeholder="Todas las familias" value={family} options={page?.filters.families ?? []} onChange={setFamily}/><SearchableFilter id="universe-subfamily" label="Subfamilia" placeholder="Todas las subfamilias" value={subfamily} options={page?.filters.subfamilies ?? []} onChange={setSubfamily}/><SearchableFilter id="universe-brand" label="Marca" placeholder="Todas las marcas" value={brand} options={page?.filters.brands ?? []} onChange={setBrand}/><label className="universe-filter-field" htmlFor="universe-status"><span>Estado</span><select id="universe-status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Todos los estados</option><option value="active">Activos con cédula</option><option value="inactive">Inactivos</option><option value="pending_card">Pendientes de cédula</option></select></label><label className="universe-filter-field" htmlFor="universe-inventory"><span>Inventario</span><select id="universe-inventory" value={inventory} onChange={(event) => setInventory(event.target.value)}><option value="all">Cualquier inventario</option><option value="available">Disponible</option><option value="zero">En cero</option><option value="negative">Negativo</option><option value="absent">Sin registro</option></select></label></div></section>
      {error && <div className="error-banner"><strong>No fue posible cargar</strong><span>{error}</span><button onClick={() => void load()}>Reintentar</button></div>}
      <article className="universe-table-card"><div className="section-head"><h2>{tab === "master" ? "Maestro corporativo y cédula" : tab === "inventory" ? "Inventario consolidado por SKU" : "Acceso al detalle por ubicación"}</h2><small>{loading ? "Consultando…" : `Mostrando ${integer.format(items.length)} de ${integer.format(page?.total ?? 0)}`}</small></div><div className="table-scroll"><table><thead><tr><th>Producto Daka</th><th>Clasificación</th><th>Cédula / estado</th><th>Inventario</th><th>Distribución</th><th>Detalle</th></tr></thead><tbody>{items.map((product) => <tr key={product.sku}><td><strong>{product.description}</strong><small>{product.sku} · {product.brand}</small><small>{product.line} · {product.family}{product.subfamily ? ` · ${product.subfamily}` : ""}</small></td><td>{product.active ? <span className="universe-state active">Activo</span> : <span className="universe-state inactive">Inactivo</span>}{!product.masterPresent && <span className="universe-state pending">Pendiente de cédula</span>}</td><td>{product.card ? <><code>{product.card.raw}</code>{product.card.warning && <span className="gmroi-warning">⚠ GMROI {integer.format(product.card.gmroi)}</span>}</> : <span className="muted">Sin cédula registrada</span>}</td><td><strong>{product.inventory.hasRecord ? integer.format(product.inventory.totalAvailable ?? 0) : "—"}</strong><small>{inventoryLabel(product)}</small>{product.inventory.totalRaw != null && product.inventory.totalRaw < 0 && <small className="negative">Valor original: {integer.format(product.inventory.totalRaw)}</small>}</td><td><span>CDD: {product.inventory.cddRaw == null ? "—" : integer.format(product.inventory.cddRaw)}</span><small>Tiendas: {product.inventory.storesRaw == null ? "—" : integer.format(product.inventory.storesRaw)}</small></td><td><button className="detail-button" onClick={() => setSelected(product)}>Ver ficha completa</button></td></tr>)}</tbody></table></div>{!loading && items.length === 0 && <div className="empty-state">No existen productos con estos filtros.</div>}<div className="changes-load-more">{page?.hasMore ? <button onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "Cargando…" : "Cargar 50 productos más"}</button> : items.length > 0 && <span>Se mostraron todos los resultados</span>}</div></article>
    </>}

    {selected && <div className="universe-drawer-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelected(null); }}><aside className="universe-drawer" role="dialog" aria-modal="true" aria-label={`Ficha de ${selected.sku}`}><header><div><span className="eyebrow-dark">Ficha integral del SKU</span><h2>{selected.description}</h2><small>{selected.sku} · {selected.brand}</small></div><button ref={closeRef} aria-label="Cerrar ficha" onClick={() => setSelected(null)}>×</button></header><div className="universe-drawer-body">{detailLoading ? <div className="empty-state">Cargando ficha…</div> : detail && <><div className="drawer-product-meta"><div><span>Línea</span><strong>{detail.product.line}</strong></div><div><span>Familia</span><strong>{detail.product.family}</strong></div><div><span>Subfamilia</span><strong>{detail.product.subfamily ?? "Sin registro"}</strong></div></div>{detail.cards[0] ? <section className="card-decoder"><h3>Cédula de octubre 2026 · <code>{detail.cards[0].raw}</code></h3><div>{[["ABC compañía", detail.cards[0].companyAbc],["ABC línea",detail.cards[0].lineAbc],["ABC familia",detail.cards[0].familyAbc],["XYZ",detail.cards[0].xyz],["Rotación",detail.cards[0].rotation],["Cobertura",detail.cards[0].coverage],["Afectación",detail.cards[0].affectation]].map(([label,value]) => <article key={label}><span>{label}</span><strong>{value}</strong><small>{cardMeaning[value] ?? "Clasificación vigente"}</small></article>)}</div><p className={detail.cards[0].warning ? "gmroi-detail warning" : "gmroi-detail"}><strong>GMROI: {integer.format(detail.cards[0].gmroi)}</strong>{detail.cards[0].warning ? " · Valor original conservado; requiere revisión analítica." : " · Valor vigente del período."}</p></section> : <div className="pending-card-message">Pendiente de cédula: este SKU aparece en inventario pero no en el Maestro de SKU de octubre.</div>}<section className="location-detail"><h3>Inventario por ubicación</h3>{detail.inventory.locations.length ? <><div className="location-summary"><strong>{integer.format(detail.inventory.locations.reduce((sum, location) => sum + location.quantityAvailable, 0))} unidades disponibles</strong><span>Valores negativos conservados en la columna original</span></div><div className="table-scroll"><table><thead><tr><th>Ubicación</th><th>Tipo</th><th>Valor original</th><th>Disponible</th></tr></thead><tbody>{visibleLocations.map((location) => <tr key={location.name}><td>{location.name}</td><td>{location.type === "cdd" ? "CDD" : "Tienda"}</td><td className={location.quantityRaw < 0 ? "negative" : ""}>{integer.format(location.quantityRaw)}</td><td>{integer.format(location.quantityAvailable)}</td></tr>)}</tbody></table></div></> : <div className="inventory-absence">Este SKU no tiene registro en el archivo de inventario del 12 de octubre de 2026.</div>}</section></>}</div></aside></div>}
  </section>;
}
