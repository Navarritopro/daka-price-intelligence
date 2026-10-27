export type PriceAdjustment = { enabled: boolean; percentage: number };
export type PriceAdjustmentSource = "venelectronics" | "daka";

export function parsePriceAdjustment(value: unknown, source: PriceAdjustmentSource = "venelectronics"): PriceAdjustment {
  if (!value || typeof value !== "object") throw new Error("Configuración inválida");
  const { enabled, percentage } = value as Record<string, unknown>;
  if (typeof enabled !== "boolean" || typeof percentage !== "number"
    || !Number.isInteger(percentage) || percentage < 1 || percentage > (source === "daka" ? 99 : 100)) {
    throw new Error(`Indica un porcentaje entero entre 1 y ${source === "daka" ? 99 : 100} y un estado válido`);
  }
  return { enabled, percentage };
}

export function priceAdjustmentNote(percentage: number, source: PriceAdjustmentSource = "venelectronics") {
  if (source === "daka") return percentage > 0
    ? `DAKA: descuento de ${percentage}% sobre el precio web capturado. Base Otras y el histórico guardado conservan sus valores originales.`
    : "DAKA: descuento desactivado; se utilizan precios web capturados. Base Otras conserva sus valores originales.";
  return percentage > 0
    ? `Venelectronics: precios ajustados +${percentage}% sobre el precio web capturado. El histórico guardado permanece original.`
    : "Venelectronics: ajuste desactivado; se utilizan precios web capturados.";
}
