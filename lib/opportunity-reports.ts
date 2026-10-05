import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
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
  return `${vetDate.format(new Date(value))} VET`;
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
  workbook.created = new Date(page.generatedAt);

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

export async function buildOpportunityPdf(page: OpportunityPage, query: OpportunityQuery) {
  const document = new PDFDocument({ size: "A4", layout: "landscape", margin: 34, bufferPages: true, info: { Title: "Centro de oportunidades comerciales DAKA" } });
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });

  const pageWidth = 773;
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

  const header = () => {
    document.rect(0, 0, 841.89, 54).fill("#003288");
    document.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(16).text("DAKA · Centro de oportunidades comerciales", 34, 18);
    document.font("Helvetica").fontSize(8).text("Uso interno DAKA", 680, 22, { width: 125, align: "right" });
    document.fillColor("#10223D");
  };

  header();
  document.font("Helvetica-Bold").fontSize(18).fillColor("#003288").text("Resumen ejecutivo", 34, 76);
  document.font("Helvetica").fontSize(8).fillColor("#526780").text(`Generado: ${formatDate(page.generatedAt)}`, 34, 102);
  document.text(describeOpportunityFilters(query), 34, 116, { width: pageWidth });
  const metrics = [
    ["Oportunidades", page.stats.total], ["Críticas o altas", page.stats.prioritized],
    ["Riesgos de precio", page.stats.priceRisks], ["Ventajas de precio", page.stats.priceAdvantages],
    ["Riesgos disponibilidad", page.stats.availabilityRisks], ["Ventajas disponibilidad", page.stats.availabilityAdvantages]
  ] as const;
  metrics.forEach(([label, value], index) => {
    const x = 34 + index * 128;
    document.roundedRect(x, 145, 117, 54, 6).fillAndStroke(index % 2 ? "#F3F7FF" : "#FFF9DD", "#D7E0EC");
    document.fillColor("#526780").font("Helvetica").fontSize(7).text(label, x + 8, 156, { width: 101 });
    document.fillColor("#10223D").font("Helvetica-Bold").fontSize(17).text(String(value), x + 8, 172, { width: 101 });
  });
  document.fillColor("#003288").font("Helvetica-Bold").fontSize(12).text("Top 5 brechas absolutas", 34, 226);
  const topFive = [...page.items].sort((a, b) => Math.abs(b.primary.differencePct ?? 0) - Math.abs(a.primary.differencePct ?? 0)).slice(0, 5);
  let topY = 251;
  topFive.forEach((item, index) => {
    const comparison = primaryComparison(item);
    document.fillColor("#10223D").font("Helvetica-Bold").fontSize(8).text(`${index + 1}. ${truncate(item.daka.name, 70)}`, 42, topY, { width: 430 });
    document.fillColor(`#${SOURCE_COLORS[item.primary.sourceName] ?? "003288"}`).text(item.primary.sourceName, 488, topY, { width: 90 });
    document.fillColor(item.primary.favorable ? "#087855" : "#B2263A").text(`${item.primary.differencePct == null ? "—" : `${item.primary.differencePct.toFixed(1)}%`} · ${comparison?.competitor.price == null ? "—" : money.format(comparison.competitor.price)}`, 590, topY, { width: 170, align: "right" });
    document.moveTo(42, topY + 16).lineTo(799, topY + 16).strokeColor("#E3EAF3").stroke();
    topY += 34;
  });
  document.fillColor("#526780").font("Helvetica").fontSize(8).text("Metodología: última ejecución exitosa de DAKA contra la última ejecución exitosa de cada competidor. Las señales apoyan la revisión comercial y no asumen margen ni recomiendan descuentos automáticamente.", 34, 443, { width: pageWidth, lineGap: 2 });

  const drawTableHeader = (y: number) => {
    let x = 34;
    document.rect(34, y, pageWidth, 24).fill("#FFCD00");
    document.fillColor("#10223D").font("Helvetica-Bold").fontSize(7);
    for (const column of columns) {
      document.text(column.label, x + 4, y + 8, { width: column.width - 8 });
      x += column.width;
    }
    return y + 24;
  };

  let y = 0;
  const newTablePage = () => {
    document.addPage();
    header();
    document.fillColor("#003288").font("Helvetica-Bold").fontSize(12).text("Detalle de oportunidades", 34, 69);
    y = drawTableHeader(92);
  };
  newTablePage();
  page.items.forEach((item, index) => {
    const rowHeight = 38;
    if (y + rowHeight > 548) newTablePage();
    if (index % 2 === 1) document.rect(34, y, pageWidth, rowHeight).fill("#F7F9FC");
    let x = 34;
    columns.forEach((column, columnIndex) => {
      const color = columnIndex === 2 ? `#${SOURCE_COLORS[item.primary.sourceName] ?? "003288"}` : columnIndex === 6 ? (item.primary.favorable ? "#087855" : "#B2263A") : "#10223D";
      document.fillColor(color).font(columnIndex === 0 || columnIndex === 2 || columnIndex === 6 ? "Helvetica-Bold" : "Helvetica").fontSize(6.5)
        .text(column.value(item), x + 4, y + 7, { width: column.width - 8, height: rowHeight - 10, ellipsis: true });
      x += column.width;
    });
    document.moveTo(34, y + rowHeight).lineTo(807, y + rowHeight).strokeColor("#E3EAF3").stroke();
    y += rowHeight;
  });

  const range = document.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    document.switchToPage(index);
    document.fillColor("#718096").font("Helvetica").fontSize(7).text(`Página ${index + 1} de ${range.count}`, 34, 548, { width: pageWidth, align: "right", lineBreak: false });
  }
  document.end();
  return completed;
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
