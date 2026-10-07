import { asNumber, getSql } from "@/lib/db";
import {
  classifyOpportunity,
  isFreshCapture,
  priorityForScore,
  type OpportunitySignal as Signal
} from "@/lib/opportunity-rules";
import { compareOpportunities, type OpportunitySort } from "@/lib/opportunity-sort";

export { compareOpportunities } from "@/lib/opportunity-sort";
export type { OpportunitySort } from "@/lib/opportunity-sort";

const COMPETITORS = {
  damasco: "Damasco",
  multimax: "Multimax",
  ivoo: "IVOO",
  venelectronics: "Venelectronics",
  soytechno: "SoyTechno"
} as const;

export type CompetitorSource = keyof typeof COMPETITORS;

export type OpportunityQuery = {
  search: string;
  source: "all" | CompetitorSource;
  brand: string;
  category: string;
  type: string;
  priority: string;
  availability: string;
  minimumGap: number;
  sort: OpportunitySort;
  limit: number;
  offset: number;
};

type PairRow = {
  match_id: unknown;
  confidence: unknown;
  daka_id: unknown;
  daka_sap: string;
  daka_name: string;
  daka_brand: string | null;
  daka_category: string | null;
  daka_url: string;
  daka_price: unknown;
  daka_previous_price: unknown;
  daka_in_stock: boolean | null;
  daka_quantity: unknown;
  daka_scraped_at: string;
  daka_job_finished_at: string;
  competitor_source: CompetitorSource;
  competitor_name: string;
  competitor_id: unknown;
  competitor_reference: string;
  competitor_product_name: string;
  competitor_brand: string | null;
  competitor_category: string | null;
  competitor_url: string;
  competitor_price: unknown;
  competitor_previous_price: unknown;
  competitor_list_price: unknown;
  competitor_in_stock: boolean | null;
  competitor_quantity: unknown;
  competitor_scraped_at: string;
  competitor_job_finished_at: string;
};

export type OpportunityComparison = {
  matchId: number;
  confidence: number;
  source: CompetitorSource;
  sourceName: string;
  competitor: {
    id: number;
    externalId: string;
    name: string;
    brand: string | null;
    category: string | null;
    url: string;
    price: number | null;
    previousPrice: number | null;
    listPrice: number | null;
    inStock: boolean | null;
    availableQuantity: number | null;
    scrapedAt: string;
  };
  differenceUsd: number | null;
  differencePct: number | null;
  fresh: boolean;
  signal: Signal | null;
};

export type Opportunity = {
  daka: {
    id: number;
    externalId: string;
    name: string;
    brand: string | null;
    category: string | null;
    url: string;
    price: number | null;
    previousPrice: number | null;
    inStock: boolean | null;
    availableQuantity: number | null;
    scrapedAt: string;
  };
  primary: (Signal & {
    source: CompetitorSource;
    sourceName: string;
    differenceUsd: number | null;
    differencePct: number | null;
  });
  comparisons: OpportunityComparison[];
  pressureCount: number;
  detectedAt: string;
};

function nullableNumber(value: unknown) {
  return value == null ? null : asNumber(value);
}

export type OpportunityStats = {
  total: number;
  prioritized: number;
  priceRisks: number;
  priceAdvantages: number;
  availabilityRisks: number;
  availabilityAdvantages: number;
  stale: number;
};

export type OpportunityPage = {
  items: Opportunity[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  minimumGap: number;
  stats: OpportunityStats;
  brands: string[];
  categories: string[];
  freshnessHours: number;
  generatedAt: string;
};

const VALID_TYPES = new Set(["all", "price_risk", "price_advantage", "availability_risk", "availability_advantage", "multi_pressure", "stale_data"]);
const VALID_PRIORITIES = new Set(["all", "critical", "high", "medium", "informative"]);
const VALID_AVAILABILITY = new Set(["all", "daka_available", "daka_unavailable", "competitor_available", "competitor_unavailable"]);
const VALID_SORTS = new Set<OpportunitySort>(["priority", "competitor_asc", "competitor_desc", "gap_usd_desc", "gap_usd_asc", "gap_pct_desc", "gap_pct_asc"]);

export function parseOpportunityQuery(searchParams: URLSearchParams): OpportunityQuery {
  const requestedSource = searchParams.get("source")?.trim() ?? "all";
  const requestedType = searchParams.get("type") ?? "all";
  const requestedPriority = searchParams.get("priority") ?? "all";
  const requestedAvailability = searchParams.get("availability") ?? "all";
  const requestedSort = searchParams.get("sort") as OpportunitySort | null;
  return {
    search: searchParams.get("search")?.trim().toLowerCase() ?? "",
    source: requestedSource === "all" || requestedSource in COMPETITORS ? requestedSource as "all" | CompetitorSource : "all",
    brand: searchParams.get("brand")?.trim() ?? "",
    category: searchParams.get("category")?.trim() ?? "",
    type: VALID_TYPES.has(requestedType) ? requestedType : "all",
    priority: VALID_PRIORITIES.has(requestedPriority) ? requestedPriority : "all",
    availability: VALID_AVAILABILITY.has(requestedAvailability) ? requestedAvailability : "all",
    minimumGap: Math.min(Math.max(Number(searchParams.get("minimumGap")) || 5, 0), 100),
    sort: requestedSort && VALID_SORTS.has(requestedSort) ? requestedSort : "priority",
    limit: Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 50),
    offset: Math.max(Number(searchParams.get("offset")) || 0, 0)
  };
}

export async function getOpportunityPage(query: OpportunityQuery, includeAll = false): Promise<OpportunityPage> {
    const sql = getSql();
    const { search, source, brand, category, type, priority, availability, minimumGap, sort, limit, offset } = query;

    const rows = await sql<PairRow[]>`
      WITH ranked_jobs AS (
        SELECT j.id, j.source_id, j.finished_at,
          ROW_NUMBER() OVER (PARTITION BY j.source_id ORDER BY j.started_at DESC) AS position
        FROM scraping_jobs j
        WHERE j.status = 'success'
      ), latest_jobs AS (
        SELECT id, source_id, finished_at FROM ranked_jobs WHERE position = 1
      ), previous_jobs AS (
        SELECT id, source_id FROM ranked_jobs WHERE position = 2
      ), daka_source AS (
        SELECT id FROM sources WHERE slug = 'daka'
      )
      SELECT
        pm.id AS match_id, pm.confidence,
        d.id AS daka_id, d.external_id AS daka_sap, d.name AS daka_name,
        d.brand AS daka_brand, d.category AS daka_category, d.url AS daka_url,
        dp.price_usd AS daka_price, dpp.price_usd AS daka_previous_price,
        dp.in_stock AS daka_in_stock, dp.available_quantity AS daka_quantity,
        dp.scraped_at AS daka_scraped_at, dlj.finished_at AS daka_job_finished_at,
        cs.slug AS competitor_source, cs.name AS competitor_name,
        c.id AS competitor_id, c.external_id AS competitor_reference,
        c.name AS competitor_product_name, c.brand AS competitor_brand,
        c.category AS competitor_category, c.url AS competitor_url,
        cp.price_usd AS competitor_price, cpp.price_usd AS competitor_previous_price,
        cp.list_price_usd AS competitor_list_price, cp.in_stock AS competitor_in_stock,
        cp.available_quantity AS competitor_quantity, cp.scraped_at AS competitor_scraped_at,
        clj.finished_at AS competitor_job_finished_at
      FROM product_matches pm
      JOIN products d ON d.id = pm.daka_product_id
      JOIN products c ON c.id = pm.competitor_product_id
      JOIN sources cs ON cs.id = c.source_id AND cs.slug IN ('damasco', 'multimax', 'ivoo', 'venelectronics', 'soytechno')
      JOIN latest_jobs dlj ON dlj.source_id = (SELECT id FROM daka_source)
      JOIN latest_jobs clj ON clj.source_id = cs.id
      JOIN price_history dp ON dp.product_id = d.id AND dp.job_id = dlj.id
      JOIN price_history cp ON cp.product_id = c.id AND cp.job_id = clj.id
      LEFT JOIN previous_jobs dpj ON dpj.source_id = (SELECT id FROM daka_source)
      LEFT JOIN previous_jobs cpj ON cpj.source_id = cs.id
      LEFT JOIN price_history dpp ON dpp.product_id = d.id AND dpp.job_id = dpj.id
      LEFT JOIN price_history cpp ON cpp.product_id = c.id AND cpp.job_id = cpj.id
      WHERE pm.status IN ('auto', 'confirmed')
      ORDER BY d.id, cs.slug, pm.confidence DESC
    `;

    const grouped = new Map<number, Opportunity>();
    const pendingComparisons = new Map<number, OpportunityComparison[]>();
    for (const row of rows) {
      const dakaPrice = nullableNumber(row.daka_price);
      const competitorPrice = nullableNumber(row.competitor_price);
      const competitorPreviousPrice = nullableNumber(row.competitor_previous_price);
      const fresh = isFreshCapture(row.daka_job_finished_at) && isFreshCapture(row.competitor_job_finished_at);
      const differenceUsd = dakaPrice == null || competitorPrice == null ? null : dakaPrice - competitorPrice;
      const differencePct = differenceUsd == null || !competitorPrice ? null : (differenceUsd / competitorPrice) * 100;
      const signal = classifyOpportunity({
        dakaPrice, competitorPrice, competitorPreviousPrice,
        dakaInStock: row.daka_in_stock, competitorInStock: row.competitor_in_stock,
        fresh, sourceName: row.competitor_name, minimumGap
      });
      const comparison: OpportunityComparison = {
        matchId: asNumber(row.match_id), confidence: asNumber(row.confidence),
        source: row.competitor_source, sourceName: row.competitor_name,
        competitor: {
          id: asNumber(row.competitor_id), externalId: row.competitor_reference,
          name: row.competitor_product_name, brand: row.competitor_brand,
          category: row.competitor_category, url: row.competitor_url,
          price: competitorPrice, previousPrice: competitorPreviousPrice,
          listPrice: nullableNumber(row.competitor_list_price),
          inStock: row.competitor_in_stock,
          availableQuantity: nullableNumber(row.competitor_quantity),
          scrapedAt: row.competitor_scraped_at
        },
        differenceUsd, differencePct, fresh, signal
      };
      const dakaId = asNumber(row.daka_id);
      const existing = grouped.get(dakaId);
      if (!existing) {
        if (!signal) {
          const pending = pendingComparisons.get(dakaId) ?? [];
          pending.push(comparison);
          pendingComparisons.set(dakaId, pending);
          continue;
        }
        grouped.set(dakaId, {
          daka: {
            id: dakaId, externalId: row.daka_sap, name: row.daka_name,
            brand: row.daka_brand, category: row.daka_category, url: row.daka_url,
            price: dakaPrice, previousPrice: nullableNumber(row.daka_previous_price),
            inStock: row.daka_in_stock, availableQuantity: nullableNumber(row.daka_quantity),
            scrapedAt: row.daka_scraped_at
          },
          primary: {
            ...signal, source: row.competitor_source, sourceName: row.competitor_name,
            differenceUsd, differencePct
          },
          comparisons: [...(pendingComparisons.get(dakaId) ?? []), comparison],
          pressureCount: signal.type === "price_risk" ? 1 : 0,
          detectedAt: row.competitor_scraped_at
        });
        pendingComparisons.delete(dakaId);
        continue;
      }
      existing.comparisons.push(comparison);
      if (signal?.type === "price_risk") existing.pressureCount += 1;
      if (signal && signal.score > existing.primary.score) {
        existing.primary = {
          ...signal, source: row.competitor_source, sourceName: row.competitor_name,
          differenceUsd, differencePct
        };
      }
      if (new Date(row.competitor_scraped_at) > new Date(existing.detectedAt)) existing.detectedAt = row.competitor_scraped_at;
    }

    let opportunities = Array.from(grouped.values()).map((item) => {
      const pressureCount = new Set(item.comparisons
        .filter((entry) => entry.signal?.type === "price_risk")
        .map((entry) => entry.source)).size;
      if (pressureCount < 2 || item.primary.type !== "price_risk") return { ...item, pressureCount };
      const score = Math.min(100, item.primary.score + 10);
      return {
        ...item, pressureCount,
        primary: {
          ...item.primary, score, priority: priorityForScore(score), label: "Presión multicompetidor",
          explanation: `${pressureCount} competidores ofrecen actualmente un precio inferior al de DAKA.`
        }
      };
    });

    if (source !== "all") {
      opportunities = opportunities.flatMap((item) => {
        const comparisons = item.comparisons.filter((entry) => entry.source === source);
        const signaled = comparisons.filter((entry): entry is OpportunityComparison & { signal: Signal } => entry.signal != null);
        if (!signaled.length) return [];
        const strongest = signaled.reduce((best, entry) => entry.signal.score > best.signal.score ? entry : best);
        const pressureCount = new Set(signaled.filter((entry) => entry.signal.type === "price_risk").map((entry) => entry.source)).size;
        return [{
          ...item, comparisons, pressureCount,
          primary: {
            ...strongest.signal, source: strongest.source, sourceName: strongest.sourceName,
            differenceUsd: strongest.differenceUsd, differencePct: strongest.differencePct
          },
          detectedAt: strongest.competitor.scrapedAt
        }];
      });
    }

    if (!["all", "multi_pressure"].includes(type)) {
      opportunities = opportunities.flatMap((item) => {
        const matching = item.comparisons.filter((entry): entry is OpportunityComparison & { signal: Signal } => entry.signal?.type === type);
        if (!matching.length) return [];
        const strongest = matching.reduce((best, entry) => entry.signal.score > best.signal.score ? entry : best);
        return [{
          ...item,
          primary: {
            ...strongest.signal, source: strongest.source, sourceName: strongest.sourceName,
            differenceUsd: strongest.differenceUsd, differencePct: strongest.differencePct
          },
          detectedAt: strongest.competitor.scrapedAt
        }];
      });
    }
    if (type === "multi_pressure") {
      opportunities = opportunities.flatMap((item) => {
        if (item.pressureCount < 2) return [];
        const risks = item.comparisons.filter((entry): entry is OpportunityComparison & { signal: Signal } => entry.signal?.type === "price_risk");
        const strongest = risks.reduce((best, entry) => entry.signal.score > best.signal.score ? entry : best);
        const score = Math.min(100, strongest.signal.score + 10);
        return [{
          ...item,
          primary: {
            ...strongest.signal, score, priority: priorityForScore(score),
            label: "Presión multicompetidor",
            explanation: `${item.pressureCount} competidores ofrecen actualmente un precio inferior al de DAKA.`,
            source: strongest.source, sourceName: strongest.sourceName,
            differenceUsd: strongest.differenceUsd, differencePct: strongest.differencePct
          },
          detectedAt: strongest.competitor.scrapedAt
        }];
      });
    }

    const normalizedBrand = brand.toLowerCase();
    const normalizedCategory = category.toLowerCase();
    opportunities = opportunities.filter((item) => {
      const relevantComparisons = item.comparisons;
      if (!relevantComparisons.some((entry) => entry.signal)) return false;
      const searchable = [item.daka.name, item.daka.externalId, item.daka.brand, item.daka.category,
        ...relevantComparisons.flatMap((entry) => [entry.competitor.name, entry.competitor.externalId, entry.competitor.brand])]
        .filter(Boolean).join(" ").toLowerCase();
      if (search && !searchable.includes(search)) return false;
      if (normalizedBrand && ![item.daka.brand, ...relevantComparisons.map((entry) => entry.competitor.brand)]
        .some((value) => value?.trim().toLowerCase() === normalizedBrand)) return false;
      if (normalizedCategory && ![item.daka.category, ...relevantComparisons.map((entry) => entry.competitor.category)]
        .some((value) => value?.trim().toLowerCase() === normalizedCategory)) return false;
      if (type === "multi_pressure" && item.pressureCount < 2) return false;
      if (type !== "all" && type !== "multi_pressure" && !relevantComparisons.some((entry) => entry.signal?.type === type)) return false;
      if (priority !== "all" && item.primary.priority !== priority) return false;
      if (availability === "daka_available" && item.daka.inStock !== true) return false;
      if (availability === "daka_unavailable" && item.daka.inStock !== false) return false;
      if (availability === "competitor_available" && !relevantComparisons.some((entry) => entry.competitor.inStock === true)) return false;
      if (availability === "competitor_unavailable" && !relevantComparisons.some((entry) => entry.competitor.inStock === false)) return false;
      return true;
    });

    const stats = {
      total: opportunities.length,
      prioritized: opportunities.filter((item) => item.primary.priority === "critical" || item.primary.priority === "high").length,
      priceRisks: opportunities.filter((item) => item.comparisons.some((entry) => entry.signal?.type === "price_risk")).length,
      priceAdvantages: opportunities.filter((item) => item.comparisons.some((entry) => entry.signal?.type === "price_advantage")).length,
      availabilityRisks: opportunities.filter((item) => item.comparisons.some((entry) => entry.signal?.type === "availability_risk")).length,
      availabilityAdvantages: opportunities.filter((item) => item.comparisons.some((entry) => entry.signal?.type === "availability_advantage")).length,
      stale: opportunities.filter((item) => item.comparisons.some((entry) => entry.signal?.type === "stale_data")).length
    };
    const brands = Array.from(new Set(rows.flatMap((row) => [row.daka_brand, row.competitor_brand]).filter((value): value is string => Boolean(value?.trim()))))
      .sort((a, b) => a.localeCompare(b, "es"));
    const categories = Array.from(new Set(rows.flatMap((row) => [row.daka_category, row.competitor_category]).filter((value): value is string => Boolean(value?.trim()))))
      .sort((a, b) => a.localeCompare(b, "es"));

    opportunities.sort((a, b) => compareOpportunities(a, b, sort));
    const pageOffset = includeAll ? 0 : offset;
    const pageLimit = includeAll ? opportunities.length : limit;
    const items = includeAll ? opportunities : opportunities.slice(pageOffset, pageOffset + pageLimit);

    return {
      items, total: opportunities.length, offset: pageOffset, limit: pageLimit,
      hasMore: !includeAll && pageOffset + items.length < opportunities.length,
      minimumGap, stats, brands, categories,
      freshnessHours: 48,
      generatedAt: new Date().toISOString()
    };
}
