export type ProductSummary = {
  id: number;
  externalId: string;
  name: string;
  category: string | null;
  url: string;
  currentPrice: number | null;
  previousPrice: number | null;
  changePct: number | null;
  scrapedAt: string | null;
  seenInLatest: boolean;
  lastSeenAt: string | null;
  brand?: string | null;
  model?: string | null;
  listPrice?: number | null;
  inStock?: boolean | null;
  availableQuantity?: number | null;
};

export type DashboardData = {
  source: string;
  productsMonitored: number;
  productsHistorical: number;
  productsNotSeen: number;
  productsWithPrice: number;
  changesToday: number;
  priceDropsToday: number;
  priceIncreasesToday: number;
  averagePrice: number;
  lastScrapeAt: string | null;
  lastJobStatus: string | null;
  lastJobAt: string | null;
  lastJobDurationSeconds: number | null;
  nextRun: string;
};

export type JobSummary = {
  id: string;
  source: "daka" | "damasco" | "multimax" | "ivoo" | "venelectronics" | "soytechno";
  sourceName: string;
  triggerType: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  productsFound: number;
  productsSaved: number;
  productsWithoutSku: number;
  pagesScanned: number;
  durationSeconds: number | null;
  errorMessage: string | null;
  logs: Array<{ time: string; level: string; message: string }>;
};

export type MonitoringSourceSummary = {
  source: "daka" | "damasco" | "multimax" | "ivoo" | "venelectronics" | "soytechno";
  sourceName: string;
  baseUrl: string;
  currentProducts: number;
  productsWithPrice: number;
  inStock: number;
  outOfStock: number;
  autoMatches: number;
  confirmedMatches: number;
  reviewMatches: number;
};

export type JobsResponse = {
  items: JobSummary[];
  sources: MonitoringSourceSummary[];
};

export type DataQualityIssueSummary = {
  code: string;
  level: "warning" | "critical";
  title: string;
  detail: string;
};

export type DataQualitySourceSummary = {
  source: JobSummary["source"];
  sourceName: string;
  baseUrl: string;
  level: "healthy" | "warning" | "critical" | "pending";
  label: string;
  issues: DataQualityIssueSummary[];
  latestSuccessAt: string | null;
  latestAttemptStatus: string | null;
  latestAttemptAt: string | null;
  productsFound: number;
  productsSaved: number;
  productsWithoutSku: number;
  pagesScanned: number;
  currentProducts: number;
  previousProducts: number | null;
  missingProducts: number;
  newProducts: number;
  productsWithPrice: number;
  matchedProducts: number;
  reviewMatches: number;
  ageHours: number | null;
  persistenceRate: number | null;
  catalogChangePercent: number | null;
  priceCoveragePercent: number | null;
  matchCoveragePercent: number | null;
};

export type DataQualityResponse = {
  generatedAt: string;
  summary: { healthy: number; warning: number; critical: number; pending: number };
  sources: DataQualitySourceSummary[];
};
