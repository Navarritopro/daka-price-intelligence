"use client";

import { useEffect, useMemo, useState } from "react";
import { apiRequest, isAbortError } from "@/lib/api-client";

type Source = "damasco" | "multimax" | "ivoo" | "venelectronics" | "soytechno";
type Signal = {
  type: "price_risk" | "price_advantage" | "availability_risk" | "availability_advantage" | "stale_data";
  label: string;
  explanation: string;
  score: number;
  priority: "critical" | "high" | "medium" | "informative";
  favorable: boolean;
};
type Product360 = {
  generatedAt: string;
  product: {
    sku: string;
    description: string;
    brand: string;
    line: string;
    family: string;
    subfamily: string | null;
    active: boolean;
    masterPresent: boolean;
    card: { raw: string; periodMonth: string; gmroi: number; warning: boolean } | null;
  };
  daka: {
    price: number | null;
    priceSource: "web" | "list" | null;
    previousWebPrice: number | null;
    listPrice: number | null;
    listEffectiveDate: string | null;
    listPriceWarning: boolean;
    webProductId: number | null;
    webUrl: string | null;
    webActive: boolean | null;
    webInStock: boolean | null;
    webQuantity: number | null;
    webScrapedAt: string | null;
    inventory: {
      hasRecord: boolean;
      effectiveDate: string | null;
      totalRaw: number | null;
      totalAvailable: number | null;
      cddAvailable: number | null;
      storesAvailable: number | null;
    };
  };
  history: {
    items: Array<{
      price: number | null;
      previousPrice: number | null;
      inStock: boolean | null;
      availableQuantity: number | null;
      scrapedAt: string;
    }>;
    captureCount: number;
    changeCount: number;
    minPrice: number | null;
    maxPrice: number | null;
  };
  comparisons: Array<{
    source: Source;
    sourceName: string;
    matched: boolean;
    match: { status: string; confidence: number; origin: "web" | "universe" } | null;
    product: {
      id: number;
      externalId: string;
      name: string;
      brand: string | null;
      url: string;
      price: number | null;
      previousPrice: number | null;
      listPrice: number | null;
      inStock: boolean | null;
      availableQuantity: number | null;
      scrapedAt: string | null;
    } | null;
    differenceUsd: number | null;
    differencePct: number | null;
    signal: Signal | null;
  }>;
  summary: {
    matchedCompetitors: number;
    activeSignals: number;
    priceRisks: number;
    priceAdvantages: number;
  };
};

const money = new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD" });
const integer = new Intl.NumberFormat("es-VE", { maximumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat("es-VE", {
  timeZone: "America/Caracas", day: "2-digit", month: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit"
});

function price(value: number | null) {
  return value == null ? "Sin precio" : money.format(value);
}

function captureDate(value: string | null) {
  return value ? `${dateTime.format(new Date(value))} VET` : "Sin captura";
}

function availability(inStock: boolean | null, quantity: number | null) {
  if (inStock === false) return "Sin disponibilidad";
  if (inStock == null) return "Disponibilidad no reportada";
  return quantity == null ? "Disponible" : `${integer.format(quantity)} unidades reportadas`;
}

function differenceLabel(value: number | null, percent: number | null) {
  if (value == null || percent == null) return "Diferencia no calculable";
  if (Math.abs(value) < 0.005) return "Mismo precio que DAKA";
  const relation = value > 0 ? "DAKA está por encima" : "DAKA está por debajo";
  return `${relation}: ${money.format(Math.abs(value))} · ${Math.abs(percent).toFixed(1)}%`;
}

function movementLabel(current: number | null, previous: number | null) {
  if (current == null || previous == null) return "Sin precio anterior comparable";
  const difference = current - previous;
  if (Math.abs(difference) < 0.005) return `Sin cambio frente a ${money.format(previous)}`;
  return `${difference > 0 ? "Subió" : "Bajó"} ${money.format(Math.abs(difference))} desde ${money.format(previous)}`;
}

export default function Product360View({ sku }: { sku: string }) {
  const [data, setData] = useState<Product360 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);
    apiRequest<Product360>(`/api/product-360/${encodeURIComponent(sku)}`, {
      cache: "no-store", signal: controller.signal
    }, {
      fallbackMessage: "No fue posible cargar la Visión 360°",
      retries: 1
    }).then(setData).catch((requestError) => {
      if (!isAbortError(requestError)) {
        setError(requestError instanceof Error ? requestError.message : "No fue posible cargar la Visión 360°");
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [retry, sku]);

  const signals = useMemo(() => data?.comparisons.filter((item) => item.signal) ?? [], [data]);
  const marketPosition = useMemo(() => {
    if (!data) return null;
    const dakaAvailable = data.daka.webProductId != null
      ? data.daka.webInStock !== false
      : data.daka.inventory.hasRecord && (data.daka.inventory.totalAvailable ?? 0) > 0;
    const offers = [
      ...(data.daka.price != null && dakaAvailable ? [{ name: "DAKA", price: data.daka.price }] : []),
      ...data.comparisons.flatMap((item) => item.product?.price != null && item.product.inStock !== false
        ? [{ name: item.sourceName, price: item.product.price }]
        : [])
    ].sort((left, right) => left.price - right.price);
    if (!offers.length) return null;
    const dakaIndex = offers.findIndex((offer) => offer.name === "DAKA");
    return { best: offers[0], worst: offers[offers.length - 1], dakaRank: dakaIndex < 0 ? null : dakaIndex + 1, total: offers.length };
  }, [data]);

  if (loading) return <div className="product-360-state" role="status">Construyendo la visión comercial del SKU…</div>;
  if (error) return <div className="product-360-state error" role="alert"><strong>No se pudo cargar la Visión 360°</strong><span>{error}</span><button onClick={() => setRetry((value) => value + 1)}>Reintentar</button></div>;
  if (!data) return null;

  return <section className="product-360" aria-label={`Visión 360 grados de ${data.product.sku}`}>
    <div className="product-360-summary" aria-label="Resumen ejecutivo del producto">
      <article><span>Precio DAKA de referencia</span><strong>{price(data.daka.price)}</strong><small>{data.daka.priceSource === "web" ? "Fuente: web DAKA" : data.daka.priceSource === "list" ? "Fuente: lista corporativa" : "Sin fuente vigente"} · {movementLabel(data.daka.price, data.daka.previousWebPrice)}</small></article>
      <article><span>Inventario total</span><strong>{data.daka.inventory.hasRecord ? integer.format(data.daka.inventory.totalAvailable ?? 0) : "Sin registro"}</strong><small>{data.daka.inventory.hasRecord ? `CDD ${integer.format(data.daka.inventory.cddAvailable ?? 0)} · tiendas ${integer.format(data.daka.inventory.storesAvailable ?? 0)}` : "No equivale a inventario cero"}</small></article>
      <article><span>Homologación competitiva</span><strong>{data.summary.matchedCompetitors} de 5</strong><small>{data.summary.activeSignals} señales comerciales vigentes</small></article>
      <article><span>Histórico web DAKA</span><strong>{data.history.captureCount} capturas</strong><small>{data.history.changeCount} cambios de precio detectados</small></article>
    </div>

    <section className="product-360-section product-360-identity">
      <div className="product-360-section-head"><div><span>Identificación consolidada</span><h3>{data.product.description}</h3></div>{data.daka.webUrl && <a href={data.daka.webUrl} target="_blank" rel="noreferrer">Abrir en DAKA ↗</a>}</div>
      <dl>
        <div><dt>SKU</dt><dd>{data.product.sku}</dd></div><div><dt>Marca</dt><dd>{data.product.brand}</dd></div>
        <div><dt>Línea</dt><dd>{data.product.line}</dd></div><div><dt>Familia</dt><dd>{data.product.family}</dd></div>
        <div><dt>Subfamilia</dt><dd>{data.product.subfamily ?? "Sin registro"}</dd></div><div><dt>Cédula / estado</dt><dd>{data.product.card?.raw ?? "Sin cédula"} · {data.product.active ? "Activo" : "Inactivo"}</dd></div>
      </dl>
    </section>

    <section className="product-360-section">
      <div className="product-360-section-head"><div><span>Comparación simultánea</span><h3>DAKA frente a cada competidor</h3></div><small>Las diferencias se calculan contra el precio DAKA mostrado arriba.</small></div>
      {marketPosition && <div className="product-360-market" aria-label="Posición competitiva por precio disponible"><div><span>Mejor precio disponible</span><strong>{marketPosition.best.name} · {price(marketPosition.best.price)}</strong></div><div><span>Posición de DAKA</span><strong>{marketPosition.dakaRank == null ? "No comparable" : `${marketPosition.dakaRank} de ${marketPosition.total}`}</strong></div><div><span>Mayor precio disponible</span><strong>{marketPosition.worst.name} · {price(marketPosition.worst.price)}</strong></div></div>}
      <div className="product-360-competitors">
        {data.comparisons.map((comparison) => <article key={comparison.source} className={`product-360-competitor source-${comparison.source}`}>
          <header><span className="source-mark" aria-hidden="true"/><div><strong>{comparison.sourceName}</strong><small>{comparison.matched ? comparison.match?.origin === "universe" ? "Homologación manual confirmada" : "Homologación web" : "Sin homologar"}</small></div></header>
          {comparison.product ? <>
            <h4>{comparison.product.name}</h4><p>{comparison.product.externalId}{comparison.product.brand ? ` · ${comparison.product.brand}` : ""}</p>
            <div className="product-360-price-row"><div><strong>{price(comparison.product.price)}</strong><small>{movementLabel(comparison.product.price, comparison.product.previousPrice)}</small></div><span>{availability(comparison.product.inStock, comparison.product.availableQuantity)}</span></div>
            <p className="product-360-gap">{differenceLabel(comparison.differenceUsd, comparison.differencePct)}</p>
            {comparison.signal ? <div className={`product-360-signal ${comparison.signal.favorable ? "favorable" : "risk"}`}><strong>{comparison.signal.label}</strong><span>{comparison.signal.explanation}</span></div> : <div className="product-360-signal neutral"><strong>Sin señal prioritaria</strong><span>No supera el umbral comercial vigente o faltan datos comparables.</span></div>}
            <footer><small>Captura: {captureDate(comparison.product.scrapedAt)}</small><a href={comparison.product.url} target="_blank" rel="noreferrer">Validar producto ↗</a></footer>
          </> : <div className="product-360-unmatched"><strong>Producto no homologado</strong><span>Este SKU aún no tiene un competidor confirmado en {comparison.sourceName}.</span></div>}
        </article>)}
      </div>
    </section>

    <section className="product-360-section product-360-history">
      <div className="product-360-section-head"><div><span>Evolución del precio web DAKA</span><h3>Últimas {data.history.items.length} capturas</h3></div><small>Mínimo {price(data.history.minPrice)} · máximo {price(data.history.maxPrice)}</small></div>
      {data.history.items.length ? <div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Precio</th><th>Precio anterior</th><th>Disponibilidad</th></tr></thead><tbody>{data.history.items.map((item, index) => <tr key={`${item.scrapedAt}-${index}`}><td>{captureDate(item.scrapedAt)}</td><td><strong>{price(item.price)}</strong></td><td>{price(item.previousPrice)}</td><td>{availability(item.inStock, item.availableQuantity)}</td></tr>)}</tbody></table></div> : <div className="product-360-empty">Este SKU no tiene histórico de capturas web.</div>}
    </section>

    <section className="product-360-section">
      <div className="product-360-section-head"><div><span>Lectura comercial</span><h3>Señales activas</h3></div><small>Actualizado {captureDate(data.generatedAt)}</small></div>
      {signals.length ? <div className="product-360-signal-list">{signals.map((item) => <article key={item.source}><strong>{item.sourceName} · {item.signal?.label}</strong><p>{item.signal?.explanation}</p></article>)}</div> : <div className="product-360-empty">No se detectan señales prioritarias con la información comparable vigente.</div>}
    </section>
  </section>;
}
