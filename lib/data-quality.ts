export type DataQualityLevel = "healthy" | "warning" | "critical" | "pending";

export type DataQualityIssue = {
  code: string;
  level: Exclude<DataQualityLevel, "healthy" | "pending">;
  title: string;
  detail: string;
};

export type SourceQualityInput = {
  latestSuccessAt: string | null;
  latestAttemptStatus: string | null;
  latestAttemptAt: string | null;
  productsFound: number;
  productsSaved: number;
  productsWithoutSku: number;
  currentProducts: number;
  previousProducts: number | null;
  productsWithPrice: number;
};

export type SourceQualityAssessment = {
  level: DataQualityLevel;
  label: string;
  issues: DataQualityIssue[];
  ageHours: number | null;
  persistenceRate: number | null;
  catalogChangePercent: number | null;
  priceCoveragePercent: number | null;
};

function percent(part: number, total: number) {
  if (total <= 0) return null;
  return Math.max(0, Math.min(100, (part / total) * 100));
}

function rounded(value: number) {
  return Math.round(value * 10) / 10;
}

export function assessSourceQuality(input: SourceQualityInput, now = Date.now()): SourceQualityAssessment {
  if (!input.latestSuccessAt) {
    return {
      level: input.latestAttemptStatus === "failed" ? "critical" : "pending",
      label: input.latestAttemptStatus === "failed" ? "Primera ejecución fallida" : "Pendiente de línea base",
      issues: input.latestAttemptStatus === "failed" ? [{
        code: "NO_SUCCESS",
        level: "critical",
        title: "No existe una captura exitosa",
        detail: "La fuente no dispone todavía de una captura válida para medir su calidad."
      }] : [],
      ageHours: null,
      persistenceRate: null,
      catalogChangePercent: null,
      priceCoveragePercent: null
    };
  }

  const issues: DataQualityIssue[] = [];
  const successTime = Date.parse(input.latestSuccessAt);
  const attemptTime = input.latestAttemptAt ? Date.parse(input.latestAttemptAt) : Number.NaN;
  const ageHours = Number.isFinite(successTime) ? Math.max(0, (now - successTime) / 3_600_000) : null;
  const persistable = Math.max(0, input.productsFound - input.productsWithoutSku);
  const persistenceRate = percent(input.productsSaved, persistable);
  const priceCoveragePercent = percent(input.productsWithPrice, input.currentProducts);
  const catalogChangePercent = input.previousProducts && input.previousProducts > 0
    ? ((input.currentProducts - input.previousProducts) / input.previousProducts) * 100
    : null;

  if (input.productsFound === 0 || input.currentProducts === 0) {
    issues.push({
      code: "EMPTY_CAPTURE",
      level: "critical",
      title: "Captura sin productos",
      detail: "La última ejecución exitosa no produjo un catálogo utilizable."
    });
  }
  if (input.latestAttemptStatus === "failed" && Number.isFinite(attemptTime) && attemptTime > successTime) {
    issues.push({
      code: "LATEST_FAILED",
      level: "critical",
      title: "La ejecución más reciente falló",
      detail: "Los datos visibles pertenecen a la última captura exitosa anterior."
    });
  }
  if (ageHours != null && ageHours > 48) {
    issues.push({ code: "STALE", level: "critical", title: "Datos vencidos", detail: `La última captura exitosa tiene ${Math.floor(ageHours)} horas.` });
  } else if (ageHours != null && ageHours > 30) {
    issues.push({ code: "AGING", level: "warning", title: "Captura atrasada", detail: `La última captura exitosa tiene ${Math.floor(ageHours)} horas.` });
  }
  if (persistenceRate != null && persistenceRate < 95) {
    issues.push({ code: "PERSISTENCE", level: "critical", title: "Persistencia incompleta", detail: `Solo se guardó ${rounded(persistenceRate)}% de los productos procesables.` });
  } else if (persistenceRate != null && persistenceRate < 99.5) {
    issues.push({ code: "PERSISTENCE", level: "warning", title: "Diferencia entre extracción y guardado", detail: `Se guardó ${rounded(persistenceRate)}% de los productos procesables.` });
  }
  if (catalogChangePercent != null && catalogChangePercent <= -30) {
    issues.push({ code: "CATALOG_DROP", level: "critical", title: "Caída crítica del catálogo", detail: `La captura disminuyó ${Math.abs(rounded(catalogChangePercent))}% frente a la anterior.` });
  } else if (catalogChangePercent != null && catalogChangePercent <= -15) {
    issues.push({ code: "CATALOG_DROP", level: "warning", title: "Caída atípica del catálogo", detail: `La captura disminuyó ${Math.abs(rounded(catalogChangePercent))}% frente a la anterior.` });
  }
  if (priceCoveragePercent != null && priceCoveragePercent < 70) {
    issues.push({ code: "PRICE_COVERAGE", level: "critical", title: "Cobertura de precios crítica", detail: `Solo ${rounded(priceCoveragePercent)}% del catálogo tiene precio.` });
  } else if (priceCoveragePercent != null && priceCoveragePercent < 90) {
    issues.push({ code: "PRICE_COVERAGE", level: "warning", title: "Cobertura de precios reducida", detail: `${rounded(priceCoveragePercent)}% del catálogo tiene precio.` });
  }

  const level: DataQualityLevel = issues.some((issue) => issue.level === "critical")
    ? "critical"
    : issues.some((issue) => issue.level === "warning") ? "warning" : "healthy";
  const label = level === "critical" ? "Requiere atención" : level === "warning" ? "Revisar" : "Correcto";
  return {
    level,
    label,
    issues,
    ageHours: ageHours == null ? null : rounded(ageHours),
    persistenceRate: persistenceRate == null ? null : rounded(persistenceRate),
    catalogChangePercent: catalogChangePercent == null ? null : rounded(catalogChangePercent),
    priceCoveragePercent: priceCoveragePercent == null ? null : rounded(priceCoveragePercent)
  };
}
