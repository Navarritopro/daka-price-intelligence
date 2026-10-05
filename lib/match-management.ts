export const MATCH_CORRECTION_REASONS = [
  "wrong_model",
  "wrong_capacity",
  "wrong_brand",
  "wrong_product_type",
  "duplicate_product",
  "restore_previous",
  "other"
] as const;

export type MatchCorrectionReason = typeof MATCH_CORRECTION_REASONS[number];
export type MatchManagementAction = "deactivate" | "replace" | "restore";

export const MATCH_CORRECTION_REASON_LABELS: Record<MatchCorrectionReason, string> = {
  wrong_model: "Modelo incorrecto",
  wrong_capacity: "Capacidad o tamaño diferente",
  wrong_brand: "Marca incorrecta",
  wrong_product_type: "Tipo de producto diferente",
  duplicate_product: "Producto duplicado",
  restore_previous: "Restauración administrativa",
  other: "Otra razón"
};

export type MatchManagementCommand = {
  action: MatchManagementAction;
  matchId: number;
  replacementProductId: number | null;
  reason: MatchCorrectionReason;
  notes: string | null;
  expectedUpdatedAt: string;
};

export function parseMatchManagementCommand(value: unknown): MatchManagementCommand | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const action = body.action;
  const matchId = Number(body.matchId);
  const replacementProductId = body.replacementProductId == null ? null : Number(body.replacementProductId);
  const reason = body.reason;
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) || null : null;
  const expectedUpdatedAt = typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt.trim() : "";
  if (!(["deactivate", "replace", "restore"] as unknown[]).includes(action)) return null;
  if (!Number.isInteger(matchId) || matchId <= 0) return null;
  if (!(MATCH_CORRECTION_REASONS as readonly unknown[]).includes(reason)) return null;
  if (!expectedUpdatedAt || !Number.isFinite(new Date(expectedUpdatedAt).getTime())) return null;
  if (action === "replace" && (!Number.isInteger(replacementProductId) || (replacementProductId ?? 0) <= 0)) return null;
  if (action !== "replace" && replacementProductId != null) return null;
  return {
    action: action as MatchManagementAction,
    matchId,
    replacementProductId,
    reason: reason as MatchCorrectionReason,
    notes,
    expectedUpdatedAt
  };
}
