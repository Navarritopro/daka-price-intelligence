export type PriceAdjustment = { enabled: boolean; percentage: number };

export function parsePriceAdjustment(value: unknown): PriceAdjustment {
  if (!value || typeof value !== "object") throw new Error("Configuración inválida");
  const { enabled, percentage } = value as Record<string, unknown>;
  if (typeof enabled !== "boolean" || typeof percentage !== "number"
    || !Number.isInteger(percentage) || percentage < 1 || percentage > 100) {
    throw new Error("Indica un porcentaje entero entre 1 y 100 y un estado válido");
  }
  return { enabled, percentage };
}

export function priceAdjustmentNote(percentage: number) {
  return percentage > 0
    ? `Venelectronics: precios ajustados +${percentage}% sobre el precio web capturado. El histórico guardado permanece original.`
    : "Venelectronics: ajuste desactivado; se utilizan precios web capturados.";
}
