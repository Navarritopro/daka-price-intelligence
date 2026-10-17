export const EXECUTIVE_SOURCES = ["daka", "damasco", "multimax", "ivoo", "venelectronics", "soytechno"] as const;
export type ExecutiveSource = typeof EXECUTIVE_SOURCES[number];

export type SourceSnapshot = {
  source: ExecutiveSource;
  name: string;
  currentAt: string | null;
  previousAt: string | null;
  captured: number;
  withPrice: number;
  available: number;
  unavailable: number;
  unknownAvailability: number;
  increased: number;
  decreased: number;
  unchanged: number;
  compared: number;
};

export type PairSnapshot = {
  dakaId: number;
  dakaSku: string;
  dakaName: string;
  dakaUrl: string;
  source: Exclude<ExecutiveSource, "daka">;
  sourceName: string;
  competitorName: string;
  competitorUrl: string;
  dakaPrice: number | null;
  competitorPrice: number | null;
  dakaAvailable: boolean | null;
  competitorAvailable: boolean | null;
  dakaAt: string | null;
  competitorAt: string | null;
};

export type ExecutiveGap = {
  sku: string;
  dakaName: string;
  dakaUrl: string;
  source: string;
  sourceName: string;
  competitorName: string;
  competitorUrl: string;
  dakaPrice: number;
  competitorPrice: number;
  gapUsd: number;
  gapPct: number;
};

export type ExecutivePosition = {
  comparedProducts: number;
  dakaBest: number;
  tiedBest: number;
  dakaWorst: number;
  competitorCheaperPairs: number;
  competitorMoreExpensivePairs: number;
  riskProducts: number;
  advantageProducts: number;
  topRisks: ExecutiveGap[];
  topAdvantages: ExecutiveGap[];
};

export function buildExecutivePosition(rows: PairSnapshot[], now = Date.now()): ExecutivePosition {
  // El mismo umbral de 48 h aplicado a la lectura comercial; no afirmar brechas con capturas antiguas.
  const recent = (date: string) => {
    const timestamp = new Date(date).getTime();
    return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= 48 * 60 * 60 * 1000;
  };
  const groups = new Map<number, Array<PairSnapshot & { gapUsd: number; gapPct: number }>>();
  let competitorCheaperPairs = 0;
  let competitorMoreExpensivePairs = 0;
  for (const row of rows) {
    if (!row.dakaAt || !row.competitorAt || !recent(row.dakaAt) || !recent(row.competitorAt)) continue;
    if (row.dakaPrice == null || row.competitorPrice == null || row.dakaPrice <= 0 || row.competitorPrice <= 0) continue;
    if (row.dakaAvailable !== true || row.competitorAvailable !== true) continue;
    const gapUsd = row.dakaPrice - row.competitorPrice;
    const gapPct = gapUsd / row.competitorPrice * 100;
    if (gapUsd > 0) competitorCheaperPairs += 1;
    if (gapUsd < 0) competitorMoreExpensivePairs += 1;
    const group = groups.get(row.dakaId) ?? [];
    group.push({ ...row, gapUsd, gapPct });
    groups.set(row.dakaId, group);
  }

  let dakaBest = 0;
  let tiedBest = 0;
  let dakaWorst = 0;
  let riskProducts = 0;
  let advantageProducts = 0;
  const risks: ExecutiveGap[] = [];
  const advantages: ExecutiveGap[] = [];
  const mapGap = (row: PairSnapshot & { gapUsd: number; gapPct: number }): ExecutiveGap => ({
    sku: row.dakaSku, dakaName: row.dakaName, dakaUrl: row.dakaUrl,
    source: row.source, sourceName: row.sourceName, competitorName: row.competitorName,
    competitorUrl: row.competitorUrl, dakaPrice: row.dakaPrice!, competitorPrice: row.competitorPrice!,
    gapUsd: row.gapUsd, gapPct: row.gapPct
  });

  for (const group of groups.values()) {
    const cheapest = Math.min(...group.map((row) => row.competitorPrice!));
    const highest = Math.max(...group.map((row) => row.competitorPrice!));
    const dakaPrice = group[0].dakaPrice!;
    if (dakaPrice < cheapest) dakaBest += 1;
    else if (dakaPrice === cheapest) tiedBest += 1;
    if (dakaPrice > highest) dakaWorst += 1;
    const risk = group.filter((row) => row.gapPct >= 5).sort((a, b) => b.gapPct - a.gapPct)[0];
    const advantage = group.filter((row) => row.gapPct <= -5).sort((a, b) => a.gapPct - b.gapPct)[0];
    if (risk) { riskProducts += 1; risks.push(mapGap(risk)); }
    if (advantage) { advantageProducts += 1; advantages.push(mapGap(advantage)); }
  }
  return {
    comparedProducts: groups.size, dakaBest, tiedBest, dakaWorst,
    competitorCheaperPairs, competitorMoreExpensivePairs, riskProducts, advantageProducts,
    topRisks: risks.sort((a, b) => b.gapPct - a.gapPct).slice(0, 5),
    topAdvantages: advantages.sort((a, b) => a.gapPct - b.gapPct).slice(0, 5)
  };
}
