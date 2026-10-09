const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const CATALOG_SOURCES = ["daka", "damasco", "multimax", "ivoo", "venelectronics", "soytechno"] as const;
export const CATALOG_CHANGE_STATES = ["all", "missing", "confirmed", "new", "recovered"] as const;
export const CATALOG_PERIODS = ["latest", "today", "7", "30", "custom"] as const;

export type CatalogSource = (typeof CATALOG_SOURCES)[number];
export type CatalogChangeState = (typeof CATALOG_CHANGE_STATES)[number];
export type CatalogPeriodMode = (typeof CATALOG_PERIODS)[number];

export type CatalogComparisonPeriod = {
  mode: CatalogPeriodMode;
  startDate: string | null;
  endDate: string | null;
  label: string;
};

export function caracasToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Caracas",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function shiftIsoDate(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function isValidIsoDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function resolveCatalogComparisonPeriod(searchParams: URLSearchParams, now = new Date()): CatalogComparisonPeriod {
  const requested = searchParams.get("period") ?? "latest";
  const mode = CATALOG_PERIODS.includes(requested as CatalogPeriodMode) ? requested as CatalogPeriodMode : "latest";
  const today = caracasToday(now);

  if (mode === "latest") {
    return { mode, startDate: null, endDate: null, label: "Últimas dos capturas completas" };
  }
  if (mode === "today") {
    return { mode, startDate: shiftIsoDate(today, -1), endDate: today, label: "Ayer vs. hoy" };
  }
  if (mode === "7" || mode === "30") {
    const days = Number(mode);
    return {
      mode,
      startDate: shiftIsoDate(today, -days),
      endDate: today,
      label: `Hace ${days} días vs. hoy`
    };
  }

  const startDate = searchParams.get("startDate") ?? "";
  const endDate = searchParams.get("endDate") ?? "";
  if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate)) {
    throw new Error("Selecciona fechas válidas para la comparación personalizada");
  }
  if (startDate >= endDate) throw new Error("La fecha inicial debe ser anterior a la fecha final");
  if (endDate > today) throw new Error("La fecha final no puede ser posterior a hoy");
  const elapsed = Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000);
  if (elapsed > 365) throw new Error("La comparación personalizada no puede superar 365 días");
  return { mode, startDate, endDate, label: "Comparación personalizada" };
}

export function normalizeCatalogSource(value: string | null) {
  if (value === "all") return "all" as const;
  return CATALOG_SOURCES.includes(value as CatalogSource) ? value as CatalogSource : "all" as const;
}

export function normalizeCatalogChangeState(value: string | null) {
  return CATALOG_CHANGE_STATES.includes(value as CatalogChangeState) ? value as CatalogChangeState : "all";
}
