import ExcelJS from "exceljs";
import {
  PDFDocument as PdfDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB
} from "pdf-lib";
import type { Opportunity, OpportunityPage, OpportunityQuery } from "@/lib/opportunities-service";

const SOURCE_COLORS: Record<string, string> = {
  Damasco: "B53112",
  Multimax: "053AED",
  IVOO: "05A94F",
  Venelectronics: "73A851"
};

const PRIORITY_LABELS: Record<string, string> = {
  critical: "Crítica", high: "Alta", medium: "Media", informative: "Informativa"
};
const SOURCE_LABELS: Record<string, string> = { damasco: "Damasco", multimax: "Multimax", ivoo: "IVOO", venelectronics: "Venelectronics" };
const TYPE_LABELS: Record<string, string> = { price_risk: "Riesgo de precio", price_advantage: "Ventaja de precio", availability_risk: "Riesgo de disponibilidad", availability_advantage: "Ventaja de disponibilidad", multi_pressure: "Presión multicompetidor", stale_data: "Datos por actualizar" };
const AVAILABILITY_LABELS: Record<string, string> = { daka_available: "DAKA disponible", daka_unavailable: "DAKA sin disponibilidad", competitor_available: "Competidor disponible", competitor_unavailable: "Competidor sin disponibilidad" };

const money = new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD" });
const vetDate = new Intl.DateTimeFormat("es-VE", {
  timeZone: "America/Caracas", day: "2-digit", month: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit"
});

function formatDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Fecha no disponible";
  return `${vetDate.format(date)} VET`;
}

function numberOrDash(value: number | null) {
  return value == null ? "—" : value;
}

function stockLabel(inStock: boolean | null, quantity: number | null) {
  if (inStock === false) return "Sin disponibilidad";
  if (inStock == null) return "No reportada";
  return quantity == null ? "Disponible" : `${quantity} unidades`;
}

function primaryComparison(item: Opportunity) {
  return item.comparisons.find((entry) => entry.source === item.primary.source && entry.signal?.type === item.primary.type)
    ?? item.comparisons.find((entry) => entry.source === item.primary.source)
    ?? item.comparisons[0];
}

export function describeOpportunityFilters(query: OpportunityQuery) {
  return [
    query.search && `Búsqueda: ${query.search}`,
    query.source !== "all" && `Competidor: ${SOURCE_LABELS[query.source] ?? query.source}`,
    query.brand && `Marca: ${query.brand}`,
    query.category && `Categoría: ${query.category}`,
    query.type !== "all" && `Tipo: ${TYPE_LABELS[query.type] ?? query.type}`,
    query.priority !== "all" && `Prioridad: ${PRIORITY_LABELS[query.priority] ?? query.priority}`,
    query.availability !== "all" && `Disponibilidad: ${AVAILABILITY_LABELS[query.availability] ?? query.availability}`,
    `Brecha mínima: ${query.minimumGap}%`
  ].filter(Boolean).join(" · ");
}

function titleRow(sheet: ExcelJS.Worksheet, title: string, lastColumn: number) {
  sheet.mergeCells(1, 1, 1, lastColumn);
  const cell = sheet.getCell(1, 1);
  cell.value = title;
  cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 15 };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF003288" } };
  cell.alignment = { vertical: "middle" };
  sheet.getRow(1).height = 28;
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FF10223D" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFCD00" } };
  row.alignment = { vertical: "middle", wrapText: true };
  row.height = 28;
}

export async function buildOpportunityExcel(page: OpportunityPage, query: OpportunityQuery) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "DAKA Price Intelligence";
  const generatedAt = new Date(page.generatedAt);
  workbook.created = Number.isFinite(generatedAt.getTime()) ? generatedAt : new Date();

  const summary = workbook.addWorksheet("Resumen", { views: [{ state: "frozen", ySplit: 1 }] });
  summary.columns = [{ width: 34 }, { width: 62 }];
  titleRow(summary, "Centro de oportunidades comerciales · Uso interno DAKA", 2);
  const summaryRows: Array<[string, string | number]> = [
    ["Generado", formatDate(page.generatedAt)],
    ["Filtros", describeOpportunityFilters(query)],
    ["Oportunidades", page.stats.total],
    ["Prioridad crítica o alta", page.stats.prioritized],
    ["Riesgos de precio", page.stats.priceRisks],
    ["Ventajas de precio", page.stats.priceAdvantages],
    ["Riesgos de disponibilidad", page.stats.availabilityRisks],
    ["Ventajas de disponibilidad", page.stats.availabilityAdvantages],
    ["Datos por actualizar", page.stats.stale],
    ["Metodología", "Última ejecución exitosa de DAKA contra la última ejecución exitosa de cada competidor. La señal apoya la revisión comercial y no asume margen ni recomienda descuentos automáticamente."]
  ];
  summary.addRows(summaryRows);
  summary.eachRow((row, index) => {
    if (index === 1) return;
    row.getCell(1).font = { bold: true, color: { argb: "FF003288" } };
    row.alignment = { vertical: "top", wrapText: true };
    row.height = index === summaryRows.length + 1 ? 58 : 25;
  });

  const opportunities = workbook.addWorksheet("Oportunidades", { views: [{ state: "frozen", ySplit: 2 }] });
  const opportunityHeaders = ["Prioridad", "Producto DAKA", "SAP", "Marca", "Competidor", "Producto competidor", "Referencia", "Situación", "Precio DAKA", "Precio competencia", "Brecha USD", "Brecha %", "Disponibilidad DAKA", "Disponibilidad competencia", "Detectado", "Enlace DAKA", "Enlace competencia"];
  opportunities.columns = opportunityHeaders.map((header, index) => ({ header, width: [14, 42, 15, 18, 18, 42, 18, 28, 16, 18, 15, 13, 23, 27, 21, 28, 28][index] }));
  opportunities.spliceRows(1, 0, ["Centro de oportunidades comerciales · Uso interno DAKA"]);
  titleRow(opportunities, "Centro de oportunidades comerciales · Uso interno DAKA", opportunityHeaders.length);
  styleHeader(opportunities.getRow(2));
  for (const item of page.items) {
    const comparison = primaryComparison(item);
    const row = opportunities.addRow([
      PRIORITY_LABELS[item.primary.priority] ?? item.primary.priority, item.daka.name, item.daka.externalId,
      item.daka.brand ?? item.daka.category ?? "Sin clasificación", item.primary.sourceName,
      comparison?.competitor.name ?? "Producto homologado", comparison?.competitor.externalId ?? "—",
      item.primary.label, numberOrDash(item.daka.price), numberOrDash(comparison?.competitor.price ?? null),
      numberOrDash(item.primary.differenceUsd), numberOrDash(item.primary.differencePct),
      stockLabel(item.daka.inStock, item.daka.availableQuantity),
      comparison ? stockLabel(comparison.competitor.inStock, comparison.competitor.availableQuantity) : "No reportada",
      formatDate(item.detectedAt), item.daka.url, comparison?.competitor.url ?? ""
    ]);
    row.alignment = { vertical: "top", wrapText: true };
    row.getCell(5).font = { bold: true, color: { argb: `FF${SOURCE_COLORS[item.primary.sourceName] ?? "003288"}` } };
  }
  opportunities.autoFilter = { from: "A2", to: `Q${Math.max(2, opportunities.rowCount)}` };
  [9, 10, 11].forEach((column) => { opportunities.getColumn(column).numFmt = '$#,##0.00;[Red]-$#,##0.00'; });
  opportunities.getColumn(12).numFmt = '0.0%;[Red]-0.0%';
  for (let row = 3; row <= opportunities.rowCount; row += 1) {
    const value = opportunities.getCell(row, 12).value;
    if (typeof value === "number") opportunities.getCell(row, 12).value = value / 100;
  }

  const detail = workbook.addWorksheet("Detalle competitivo", { views: [{ state: "frozen", ySplit: 2 }] });
  const detailHeaders = ["Producto DAKA", "SAP", "Precio DAKA", "Competidor", "Producto competidor", "Referencia", "Precio actual", "Precio anterior", "Precio lista", "Brecha USD", "Brecha %", "Disponibilidad", "Unidades", "Homologación %", "Señal", "Captura"];
  detail.columns = detailHeaders.map((header, index) => ({ header, width: [42, 15, 16, 18, 42, 18, 16, 16, 16, 15, 13, 22, 12, 16, 28, 21][index] }));
  detail.spliceRows(1, 0, ["Detalle de todos los competidores homologados"]);
  titleRow(detail, "Detalle de todos los competidores homologados", detailHeaders.length);
  styleHeader(detail.getRow(2));
  for (const item of page.items) {
    for (const comparison of item.comparisons) {
      const row = detail.addRow([
        item.daka.name, item.daka.externalId, numberOrDash(item.daka.price), comparison.sourceName,
        comparison.competitor.name, comparison.competitor.externalId, numberOrDash(comparison.competitor.price),
        numberOrDash(comparison.competitor.previousPrice), numberOrDash(comparison.competitor.listPrice),
        numberOrDash(comparison.differenceUsd), numberOrDash(comparison.differencePct),
        stockLabel(comparison.competitor.inStock, comparison.competitor.availableQuantity),
        numberOrDash(comparison.competitor.availableQuantity), comparison.confidence, comparison.signal?.label ?? "Sin señal",
        formatDate(comparison.competitor.scrapedAt)
      ]);
      row.alignment = { vertical: "top", wrapText: true };
      row.getCell(4).font = { bold: true, color: { argb: `FF${SOURCE_COLORS[comparison.sourceName] ?? "003288"}` } };
    }
  }
  detail.autoFilter = { from: "A2", to: `P${Math.max(2, detail.rowCount)}` };
  [3, 7, 8, 9, 10].forEach((column) => { detail.getColumn(column).numFmt = '$#,##0.00;[Red]-$#,##0.00'; });
  detail.getColumn(11).numFmt = '0.0%;[Red]-0.0%';
  detail.getColumn(14).numFmt = '0%';
  for (let row = 3; row <= detail.rowCount; row += 1) {
    const value = detail.getCell(row, 11).value;
    if (typeof value === "number") detail.getCell(row, 11).value = value / 100;
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

type PdfColumn = { label: string; width: number; value: (item: Opportunity) => string };

function truncate(value: string, length: number) {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

function pdfColor(hex: string): RGB {
  const normalized = hex.replace("#", "");
  return rgb(
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255
  );
}

function safePdfText(value: unknown, font: PDFFont) {
  const text = String(value ?? "");
  return Array.from(text, (character) => {
    try {
      font.encodeText(character);
      return character;
    } catch {
      const ascii = character.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "");
      return ascii || "?";
    }
  }).join("");
}

function drawPdfText(page: PDFPage, value: unknown, font: PDFFont, options: Parameters<PDFPage["drawText"]>[1]) {
  page.drawText(safePdfText(value, font), { ...options, font });
}

export async function buildOpportunityPdf(page: OpportunityPage, query: OpportunityQuery) {
  const document = await PdfDocument.create();
  document.setTitle("Centro de oportunidades comerciales DAKA");
  document.setAuthor("DAKA Price Intelligence");
  document.setCreator("DAKA Price Intelligence");
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const width = 841.89;
  const height = 595.28;
  const contentWidth = 773;
  const columns: PdfColumn[] = [
    { label: "Prioridad", width: 55, value: (item) => PRIORITY_LABELS[item.primary.priority] ?? item.primary.priority },
    { label: "Producto DAKA", width: 158, value: (item) => `${truncate(item.daka.name, 46)}\nSAP ${item.daka.externalId}` },
    { label: "Competencia", width: 120, value: (item) => `${item.primary.sourceName}\n${truncate(primaryComparison(item)?.competitor.name ?? "Producto homologado", 33)}` },
    { label: "Situación", width: 118, value: (item) => truncate(item.primary.label, 34) },
    { label: "DAKA", width: 70, value: (item) => item.daka.price == null ? "—" : money.format(item.daka.price) },
    { label: "Competidor", width: 76, value: (item) => { const value = primaryComparison(item)?.competitor.price; return value == null ? "—" : money.format(value); } },
    { label: "Brecha", width: 76, value: (item) => `${item.primary.differenceUsd == null ? "—" : money.format(item.primary.differenceUsd)}\n${item.primary.differencePct == null ? "—" : `${item.primary.differencePct.toFixed(1)}%`}` },
    { label: "Disponibilidad", width: 100, value: (item) => { const competitor = primaryComparison(item)?.competitor; return `D: ${stockLabel(item.daka.inStock, item.daka.availableQuantity)}\nC: ${competitor ? stockLabel(competitor.inStock, competitor.availableQuantity) : "No reportada"}`; } }
  ];

  const header = (pdfPage: PDFPage) => {
    pdfPage.drawRectangle({ x: 0, y: height - 54, width, height: 54, color: pdfColor("003288") });
    drawPdfText(pdfPage, "DAKA · Centro de oportunidades comerciales", bold, { x: 34, y: height - 35, size: 16, color: pdfColor("FFFFFF") });
    const internal = safePdfText("Uso interno DAKA", regular);
    drawPdfText(pdfPage, internal, regular, { x: width - 34 - regular.widthOfTextAtSize(internal, 8), y: height - 33, size: 8, color: pdfColor("FFFFFF") });
  };

  const summaryPage = document.addPage([width, height]);
  header(summaryPage);
  drawPdfText(summaryPage, "Resumen ejecutivo", bold, { x: 34, y: height - 94, size: 18, color: pdfColor("003288") });
  drawPdfText(summaryPage, `Generado: ${formatDate(page.generatedAt)}`, regular, { x: 34, y: height - 113, size: 8, color: pdfColor("526780") });
  drawPdfText(summaryPage, truncate(describeOpportunityFilters(query), 170), regular, { x: 34, y: height - 127, size: 8, color: pdfColor("526780") });
  const metrics = [
    ["Oportunidades", page.stats.total], ["Críticas o altas", page.stats.prioritized],
    ["Riesgos de precio", page.stats.priceRisks], ["Ventajas de precio", page.stats.priceAdvantages],
    ["Riesgos disponibilidad", page.stats.availabilityRisks], ["Ventajas disponibilidad", page.stats.availabilityAdvantages]
  ] as const;
  metrics.forEach(([label, value], index) => {
    const x = 34 + index * 128;
    summaryPage.drawRectangle({ x, y: height - 199, width: 117, height: 54, color: pdfColor(index % 2 ? "F3F7FF" : "FFF9DD"), borderColor: pdfColor("D7E0EC"), borderWidth: 1 });
    drawPdfText(summaryPage, label, regular, { x: x + 8, y: height - 166, size: 7, color: pdfColor("526780") });
    drawPdfText(summaryPage, value, bold, { x: x + 8, y: height - 187, size: 17, color: pdfColor("10223D") });
  });
  drawPdfText(summaryPage, "Top 5 mayores brechas de precio entre DAKA y la competencia", bold, { x: 34, y: height - 238, size: 12, color: pdfColor("003288") });
  const topFive = page.items
    .filter((item) => item.primary.differencePct != null && primaryComparison(item)?.competitor.price != null)
    .sort((a, b) => Math.abs(b.primary.differencePct ?? 0) - Math.abs(a.primary.differencePct ?? 0))
    .slice(0, 5);
  let topY = height - 260;
  topFive.forEach((item, index) => {
    const comparison = primaryComparison(item);
    if (!comparison) return;
    const favorable = item.primary.favorable;
    const signalColor = favorable ? "087855" : "B2263A";
    const signalBackground = favorable ? "EEF9F4" : "FFF2F3";
    const status = favorable ? "VENTAJA" : "RIESGO";
    const interpretation = item.primary.differenceUsd == null
      ? `${status}: brecha porcentual ${item.primary.differencePct?.toFixed(1) ?? "—"}%`
      : `${status}: DAKA está ${money.format(Math.abs(item.primary.differenceUsd))} ${favorable ? "más económico" : "más caro"} (${item.primary.differencePct?.toFixed(1) ?? "—"}%)`;

    summaryPage.drawRectangle({ x: 34, y: topY - 32, width: contentWidth, height: 39, color: pdfColor(signalBackground), borderColor: pdfColor("D7E0EC"), borderWidth: 0.7 });
    summaryPage.drawRectangle({ x: 34, y: topY - 32, width: 4, height: 39, color: pdfColor(signalColor) });

    drawPdfText(summaryPage, `${index + 1}. Producto DAKA: ${truncate(item.daka.name, 52)}`, bold, { x: 44, y: topY - 6, size: 7.5, color: pdfColor("10223D") });
    drawPdfText(summaryPage, `Producto ${item.primary.sourceName}: ${truncate(comparison.competitor.name, 48)}`, bold, { x: 414, y: topY - 6, size: 7.5, color: pdfColor(SOURCE_COLORS[item.primary.sourceName] ?? "003288") });

    const dakaPrice = item.daka.price == null ? "No reportado" : money.format(item.daka.price);
    const competitorPrice = comparison.competitor.price == null ? "No reportado" : money.format(comparison.competitor.price);
    drawPdfText(summaryPage, `SAP ${truncate(item.daka.externalId, 20)}`, regular, { x: 50, y: topY - 22, size: 6.7, color: pdfColor("526780") });
    drawPdfText(summaryPage, `DAKA: ${dakaPrice}`, bold, { x: 190, y: topY - 22, size: 6.7, color: pdfColor("003288") });
    drawPdfText(summaryPage, `${item.primary.sourceName}: ${competitorPrice}`, bold, { x: 414, y: topY - 22, size: 6.7, color: pdfColor(SOURCE_COLORS[item.primary.sourceName] ?? "003288") });
    drawPdfText(summaryPage, interpretation, bold, { x: 535, y: topY - 22, size: 6.7, color: pdfColor(signalColor) });
    topY -= 43;
  });
  if (!topFive.length) {
    drawPdfText(summaryPage, "No existen brechas de precio comparables con los filtros seleccionados.", regular, { x: 42, y: topY - 8, size: 8, color: pdfColor("526780") });
  }
  drawPdfText(summaryPage, "Metodología: última ejecución exitosa de DAKA contra la última ejecución exitosa de cada competidor.", regular, { x: 34, y: 80, size: 7.5, color: pdfColor("526780") });
  drawPdfText(summaryPage, "Las señales apoyan la revisión comercial y no asumen margen ni recomiendan descuentos automáticamente.", regular, { x: 34, y: 68, size: 7.5, color: pdfColor("526780") });

  const drawTableHeader = (pdfPage: PDFPage, y: number) => {
    let x = 34;
    pdfPage.drawRectangle({ x: 34, y: y - 24, width: contentWidth, height: 24, color: pdfColor("FFCD00") });
    for (const column of columns) {
      drawPdfText(pdfPage, column.label, bold, { x: x + 4, y: y - 16, size: 7, color: pdfColor("10223D") });
      x += column.width;
    }
    return y - 24;
  };

  let y = 0;
  let tablePage: PDFPage;
  const newTablePage = () => {
    tablePage = document.addPage([width, height]);
    header(tablePage);
    drawPdfText(tablePage, "Detalle de oportunidades", bold, { x: 34, y: height - 79, size: 12, color: pdfColor("003288") });
    y = drawTableHeader(tablePage, height - 92);
  };
  newTablePage();
  page.items.forEach((item, index) => {
    const rowHeight = 38;
    if (y - rowHeight < 47) newTablePage();
    if (index % 2 === 1) tablePage.drawRectangle({ x: 34, y: y - rowHeight, width: contentWidth, height: rowHeight, color: pdfColor("F7F9FC") });
    let x = 34;
    columns.forEach((column, columnIndex) => {
      const color = columnIndex === 2 ? SOURCE_COLORS[item.primary.sourceName] ?? "003288" : columnIndex === 6 ? (item.primary.favorable ? "087855" : "B2263A") : "10223D";
      const cellFont = columnIndex === 0 || columnIndex === 2 || columnIndex === 6 ? bold : regular;
      const lines = column.value(item).split("\n").slice(0, 2);
      lines.forEach((line, lineIndex) => {
        drawPdfText(tablePage, truncate(line, Math.max(8, Math.floor(column.width / 3.7))), cellFont, { x: x + 4, y: y - 12 - lineIndex * 10, size: 6.5, color: pdfColor(color) });
      });
      x += column.width;
    });
    tablePage.drawLine({ start: { x: 34, y: y - rowHeight }, end: { x: 807, y: y - rowHeight }, thickness: 1, color: pdfColor("E3EAF3") });
    y -= rowHeight;
  });

  const pages = document.getPages();
  pages.forEach((pdfPage, index) => {
    const footer = safePdfText(`Página ${index + 1} de ${pages.length}`, regular);
    drawPdfText(pdfPage, footer, regular, { x: width - 34 - regular.widthOfTextAtSize(footer, 7), y: 27, size: 7, color: pdfColor("718096") });
  });
  return Buffer.from(await document.save({ useObjectStreams: false }));
}

export function buildOpportunityTelegramCaption(page: OpportunityPage, query: OpportunityQuery) {
  const topFive = [...page.items].sort((a, b) => Math.abs(b.primary.differencePct ?? 0) - Math.abs(a.primary.differencePct ?? 0)).slice(0, 5);
  const lines = [
    "Centro de oportunidades comerciales DAKA",
    `${page.stats.total} oportunidades · ${page.stats.prioritized} críticas/altas`,
    `Filtros: ${describeOpportunityFilters(query)}`,
    "",
    "Top 5 brechas:",
    ...topFive.map((item, index) => `${index + 1}. ${truncate(item.daka.name, 42)} · ${item.primary.sourceName} · ${item.primary.differencePct == null ? "—" : `${item.primary.differencePct.toFixed(1)}%`}`),
    "",
    "PDF adjunto con el detalle completo filtrado."
  ];
  return lines.join("\n").slice(0, 1000);
}

export function opportunityReportFilename(extension: "xlsx" | "pdf", date = new Date()) {
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return `oportunidades-daka-${stamp}.${extension}`;
}
