export type OpportunityType =
  | "price_risk"
  | "price_advantage"
  | "availability_risk"
  | "availability_advantage"
  | "stale_data";

export type OpportunityPriority = "critical" | "high" | "medium" | "informative";

export type OpportunitySignal = {
  type: OpportunityType;
  label: string;
  explanation: string;
  score: number;
  priority: OpportunityPriority;
  favorable: boolean;
  recentCompetitorDrop: boolean;
};

export function priorityForScore(score: number): OpportunityPriority {
  if (score >= 90) return "critical";
  if (score >= 70) return "high";
  if (score >= 50) return "medium";
  return "informative";
}

export function isFreshCapture(value: string, now = Date.now()) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && now - timestamp <= 48 * 60 * 60 * 1000;
}

export function classifyOpportunity(input: {
  dakaPrice: number | null;
  competitorPrice: number | null;
  competitorPreviousPrice: number | null;
  dakaInStock: boolean | null;
  competitorInStock: boolean | null;
  fresh: boolean;
  sourceName: string;
  minimumGap: number;
}): OpportunitySignal | null {
  const { dakaPrice, competitorPrice, competitorPreviousPrice, dakaInStock, competitorInStock, fresh, sourceName, minimumGap } = input;
  if (!fresh) {
    return {
      type: "stale_data", label: "Datos por actualizar",
      explanation: `La captura de DAKA o ${sourceName} tiene más de 48 horas. No se confirma una oportunidad comercial con información desactualizada.`,
      score: 20, priority: "informative", favorable: false, recentCompetitorDrop: false
    };
  }
  if (dakaInStock === false && competitorInStock === true) {
    return {
      type: "availability_risk", label: "Riesgo de disponibilidad",
      explanation: `DAKA no tiene disponibilidad reportada y ${sourceName} sí dispone del producto.`,
      score: 100, priority: "critical", favorable: false, recentCompetitorDrop: false
    };
  }
  if (dakaInStock === true && competitorInStock === false) {
    return {
      type: "availability_advantage", label: "Ventaja de disponibilidad",
      explanation: `DAKA dispone del producto y ${sourceName} lo reporta sin disponibilidad.`,
      score: 70, priority: "high", favorable: true, recentCompetitorDrop: false
    };
  }
  if (dakaPrice == null || competitorPrice == null || competitorPrice === 0 || dakaInStock !== true || competitorInStock !== true) return null;
  const gapPct = ((dakaPrice - competitorPrice) / competitorPrice) * 100;
  const recentCompetitorDrop = competitorPreviousPrice != null && competitorPrice < competitorPreviousPrice;
  if (gapPct >= minimumGap) {
    const baseScore = gapPct >= 15 ? 95 : gapPct >= 10 ? 90 : 75;
    const score = Math.min(100, baseScore + (recentCompetitorDrop ? 5 : 0));
    return {
      type: "price_risk", label: recentCompetitorDrop ? "Rebaja competitiva" : "Riesgo de precio",
      explanation: recentCompetitorDrop
        ? `${sourceName} redujo su precio y actualmente ofrece una diferencia de ${gapPct.toFixed(1)}% frente a DAKA.`
        : `DAKA está ${gapPct.toFixed(1)}% por encima del precio vigente de ${sourceName}.`,
      score, priority: priorityForScore(score), favorable: false, recentCompetitorDrop
    };
  }
  if (gapPct <= -minimumGap) {
    const advantage = Math.abs(gapPct);
    const score = advantage >= 15 ? 70 : advantage >= 10 ? 60 : 50;
    return {
      type: "price_advantage", label: "Ventaja de precio",
      explanation: `DAKA está ${advantage.toFixed(1)}% por debajo del precio vigente de ${sourceName}.`,
      score, priority: priorityForScore(score), favorable: true, recentCompetitorDrop: false
    };
  }
  return null;
}
