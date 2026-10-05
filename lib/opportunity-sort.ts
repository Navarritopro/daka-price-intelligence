export type OpportunitySort =
  | "priority"
  | "competitor_asc"
  | "competitor_desc"
  | "gap_usd_desc"
  | "gap_usd_asc"
  | "gap_pct_desc"
  | "gap_pct_asc";

type SortableOpportunity = {
  daka: { name: string };
  primary: {
    sourceName: string;
    score: number;
    differenceUsd: number | null;
    differencePct: number | null;
  };
};

function defaultOpportunityOrder(a: SortableOpportunity, b: SortableOpportunity) {
  return b.primary.score - a.primary.score
    || Math.abs(b.primary.differencePct ?? 0) - Math.abs(a.primary.differencePct ?? 0)
    || a.daka.name.localeCompare(b.daka.name, "es");
}

function compareMagnitude(a: number | null, b: number | null, direction: "asc" | "desc") {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return direction === "asc" ? Math.abs(a) - Math.abs(b) : Math.abs(b) - Math.abs(a);
}

export function compareOpportunities(a: SortableOpportunity, b: SortableOpportunity, sort: OpportunitySort) {
  const fallback = () => defaultOpportunityOrder(a, b);
  if (sort === "competitor_asc") return a.primary.sourceName.localeCompare(b.primary.sourceName, "es") || fallback();
  if (sort === "competitor_desc") return b.primary.sourceName.localeCompare(a.primary.sourceName, "es") || fallback();
  if (sort === "gap_usd_desc") return compareMagnitude(a.primary.differenceUsd, b.primary.differenceUsd, "desc") || fallback();
  if (sort === "gap_usd_asc") return compareMagnitude(a.primary.differenceUsd, b.primary.differenceUsd, "asc") || fallback();
  if (sort === "gap_pct_desc") return compareMagnitude(a.primary.differencePct, b.primary.differencePct, "desc") || fallback();
  if (sort === "gap_pct_asc") return compareMagnitude(a.primary.differencePct, b.primary.differencePct, "asc") || fallback();
  return fallback();
}
