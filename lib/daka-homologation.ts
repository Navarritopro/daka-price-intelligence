export type HomologationSort = "pending_desc" | "pending_asc" | "gap_desc" | "name";

export const HOMOLOGATION_SORTS: readonly HomologationSort[] = ["pending_desc", "pending_asc", "gap_desc", "name"];

export function normalizeHomologationText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenSet(value: unknown) {
  return new Set(normalizeHomologationText(value).split(" ").filter((token) => token.length > 1));
}

function numericTokens(value: unknown) {
  return [...tokenSet(value)].filter((token) => /\d/.test(token));
}

export function candidateScore(
  master: { description: string; brand: string; line: string; family: string },
  candidate: { name: string; brand?: string | null; model?: string | null; category?: string | null }
) {
  const masterText = normalizeHomologationText(master.description);
  const candidateText = normalizeHomologationText(`${candidate.name} ${candidate.model ?? ""}`);
  const masterTokens = tokenSet(masterText);
  const candidateTokens = tokenSet(candidateText);
  const intersection = [...masterTokens].filter((token) => candidateTokens.has(token)).length;
  const coverage = intersection / Math.max(1, Math.min(masterTokens.size, candidateTokens.size));

  const masterBrand = normalizeHomologationText(master.brand);
  const candidateBrand = normalizeHomologationText(candidate.brand);
  const brandScore = masterBrand && candidateBrand && (masterBrand === candidateBrand || candidateText.includes(masterBrand)) ? 0.24 : 0;

  const categoryTokens = tokenSet(`${master.line} ${master.family}`);
  const candidateCategory = tokenSet(`${candidate.category ?? ""} ${candidate.name}`);
  const categoryScore = [...categoryTokens].some((token) => candidateCategory.has(token)) ? 0.1 : 0;

  const masterNumbers = numericTokens(master.description);
  const sharedNumbers = masterNumbers.filter((token) => candidateTokens.has(token));
  const numberScore = masterNumbers.length ? (sharedNumbers.length / masterNumbers.length) * 0.22 : 0;

  const candidateModel = normalizeHomologationText(candidate.model);
  const modelScore = candidateModel && masterText.includes(candidateModel) ? 0.2 : 0;
  return Math.min(0.99, coverage * 0.34 + brandScore + categoryScore + numberScore + modelScore);
}

export function suggestionLevel(score: number): "high" | "medium" | "exploratory" {
  if (score >= 0.65) return "high";
  if (score >= 0.4) return "medium";
  return "exploratory";
}
