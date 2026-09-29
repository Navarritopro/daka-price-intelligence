const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CUSTOM_DAYS = 365;

export type ComparisonPeriod = {
  mode: "preset" | "custom";
  days: number;
  startDate: string;
  endDate: string;
  totalDays: number;
};

function caracasToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Caracas",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function isValidIsoDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function shiftIsoDate(value: string, amount: number) {
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day + amount));
  return parsed.toISOString().slice(0, 10);
}

function inclusiveDays(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function resolveComparisonPeriod(searchParams: URLSearchParams): ComparisonPeriod {
  const requested = searchParams.get("days") ?? "30";
  const today = caracasToday();

  if (requested !== "custom") {
    const parsed = Number(requested);
    const days = [7, 30, 90].includes(parsed) ? parsed : 30;
    return { mode: "preset", days, startDate: shiftIsoDate(today, -(days - 1)), endDate: today, totalDays: days };
  }

  const startDate = searchParams.get("startDate") ?? "";
  const endDate = searchParams.get("endDate") ?? "";
  if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate)) {
    throw new Error("Selecciona fechas válidas para el rango personalizado");
  }
  if (startDate > endDate) throw new Error("La fecha Desde no puede ser posterior a la fecha Hasta");
  if (endDate > today) throw new Error("La fecha Hasta no puede ser posterior a hoy");
  const totalDays = inclusiveDays(startDate, endDate);
  if (totalDays > MAX_CUSTOM_DAYS) throw new Error(`El rango personalizado no puede superar ${MAX_CUSTOM_DAYS} días`);

  return { mode: "custom", days: totalDays, startDate, endDate, totalDays };
}
