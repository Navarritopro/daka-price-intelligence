import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";
import ExcelJS from "exceljs";
import {
  buildOpportunityExcel,
  buildOpportunityPdf,
  buildOpportunityTelegramCaption,
  describeOpportunityFilters,
  opportunityReportFilename
} from "../lib/opportunity-reports.ts";

const query = {
  search: "tv", source: "all", brand: "Samsung", category: "Televisores",
  type: "all", priority: "all", availability: "all", minimumGap: 5,
  sort: "gap_pct_desc", limit: 50, offset: 0
};

const item = {
  daka: { id: 1, externalId: "SAP-1", name: "Televisor Samsung 55 pulgadas", brand: "Samsung", category: "Televisores", url: "https://example.com/daka", price: 500, previousPrice: 520, inStock: true, availableQuantity: 8, scrapedAt: "2026-10-05T12:00:00Z" },
  primary: { type: "price_risk", label: "Riesgo de precio", explanation: "Competidor más económico", score: 90, priority: "high", favorable: false, recentCompetitorDrop: false, source: "damasco", sourceName: "Damasco", differenceUsd: 100, differencePct: 25 },
  comparisons: [{ matchId: 1, confidence: .95, source: "damasco", sourceName: "Damasco", competitor: { id: 2, externalId: "REF-2", name: "Smart TV Samsung 55", brand: "Samsung", category: "Televisores", url: "https://example.com/damasco", price: 400, previousPrice: 410, listPrice: 450, inStock: true, availableQuantity: 3, scrapedAt: "2026-10-05T12:05:00Z" }, differenceUsd: 100, differencePct: 25, fresh: true, signal: { type: "price_risk", label: "Riesgo de precio", explanation: "Competidor más económico", score: 90, priority: "high", favorable: false, recentCompetitorDrop: false } }],
  pressureCount: 1, detectedAt: "2026-10-05T12:05:00Z"
};

const page = {
  items: [item], total: 1, offset: 0, limit: 1, hasMore: false, minimumGap: 5,
  stats: { total: 1, prioritized: 1, priceRisks: 1, priceAdvantages: 0, availabilityRisks: 0, availabilityAdvantages: 0, stale: 0 },
  brands: ["Samsung"], categories: ["Televisores"], freshnessHours: 48, generatedAt: "2026-10-05T12:10:00Z"
};

test("Excel contiene las tres hojas y el detalle completo", async () => {
  const buffer = await buildOpportunityExcel(page, query);
  assert.equal(buffer.subarray(0, 2).toString(), "PK");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Resumen", "Oportunidades", "Detalle competitivo"]);
  assert.equal(workbook.getWorksheet("Oportunidades").getCell("B3").value, item.daka.name);
  assert.equal(workbook.getWorksheet("Detalle competitivo").getCell("D3").value, "Damasco");
});

test("PDF se genera como documento válido", async () => {
  const buffer = await buildOpportunityPdf(page, query);
  assert.equal(buffer.subarray(0, 4).toString(), "%PDF");
  assert.ok(buffer.length > 2_000);
  if (process.env.PDF_PREVIEW_PATH) await writeFile(process.env.PDF_PREVIEW_PATH, buffer);
});

test("PDF pagina una tabla extensa sin agregar páginas vacías", async () => {
  const items = Array.from({ length: 40 }, (_, index) => ({
    ...item,
    daka: { ...item.daka, id: index + 1, externalId: `SAP-${index + 1}`, name: `${item.daka.name} ${index + 1}` },
    comparisons: item.comparisons.map((comparison) => ({ ...comparison, matchId: index + 1 }))
  }));
  const buffer = await buildOpportunityPdf({ ...page, items, total: items.length, limit: items.length, stats: { ...page.stats, total: items.length } }, query);
  const pageObjects = buffer.toString("latin1").match(/\/Type \/Page\b/g) ?? [];
  assert.equal(pageObjects.length, 5);
});

test("PDF tolera caracteres no compatibles y fechas defectuosas", async () => {
  const resilientItem = {
    ...item,
    daka: { ...item.daka, name: `${item.daka.name} 🚀` },
    comparisons: item.comparisons.map((comparison) => ({
      ...comparison,
      competitor: { ...comparison.competitor, name: `${comparison.competitor.name} 日本語` }
    })),
    detectedAt: "fecha-invalida"
  };
  const buffer = await buildOpportunityPdf({ ...page, items: [resilientItem], generatedAt: "fecha-invalida" }, query);
  assert.equal(buffer.subarray(0, 4).toString(), "%PDF");
  assert.ok(buffer.length > 2_000);
});

test("Resumen de Telegram es breve y conserva filtros", () => {
  const caption = buildOpportunityTelegramCaption(page, query);
  assert.match(caption, /Top 5 brechas/);
  assert.match(caption, /Damasco/);
  assert.ok(caption.length <= 1000);
  assert.match(describeOpportunityFilters(query), /Samsung/);
});

test("Nombre del archivo usa una extensión aprobada", () => {
  assert.match(opportunityReportFilename("pdf", new Date("2026-10-05T12:00:00Z")), /^oportunidades-daka-\d{4}-\d{2}-\d{2}\.pdf$/);
});
