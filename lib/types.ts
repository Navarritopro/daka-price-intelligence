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
  lastJobDurationSeconds: number | null;
  nextRun: string;
};

export type JobSummary = {
  id: string;
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
