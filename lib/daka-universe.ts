import ExcelJS from "exceljs";

export const DAKA_CARD_PERIOD = "2026-10-01";
export const DAKA_INVENTORY_EFFECTIVE_DATE = "2026-10-12";

export type DakaCard = {
  raw: string;
  companyAbc: string;
  lineAbc: string;
  familyAbc: string;
  gmroi: number;
  xyz: string;
  rotation: string;
  coverage: string;
  affectation: string;
  warning: boolean;
};

export type MasterRow = {
  sku: string;
  line: string;
  family: string;
  brand: string;
  description: string;
  card: DakaCard;
  rowNumber: number;
};

export type InventoryRow = {
  sku: string;
  description: string;
  line: string;
  brand: string;
  family: string;
  subfamily: string;
  quantity: number;
  location: string;
  rowNumber: number;
};

export type PriceListRow = {
  sku: string;
  description: string;
  price: number;
  rowNumber: number;
};

export type ImportPreview = {
  kind: "master" | "inventory" | "price_list";
  filename: string;
  rowCount: number;
  uniqueSkus: number;
  warnings: string[];
  stats: Record<string, number>;
  sample: Array<Record<string, string | number | boolean>>;
};

const text = (value: unknown) => String(value ?? "").trim();
const normalizedHeader = (value: unknown) => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export function normalizeLocation(value: unknown) {
  return text(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ");
}

export function parseDakaCard(value: unknown): DakaCard {
  const raw = text(value).toUpperCase().replace(/\s+/g, "");
  const match = /^([ABCN])([ABCN])([ABCN])(-?\d+(?:[.,]\d+)?)([XYZN])([RELN])([SODN])([PTFN])$/.exec(raw);
  if (!match) throw new Error(`Cédula inválida: ${raw || "vacía"}`);
  const gmroi = Number(match[4].replace(",", "."));
  if (!Number.isFinite(gmroi)) throw new Error(`GMROI inválido en la cédula ${raw}`);
  return {
    raw,
    companyAbc: match[1], lineAbc: match[2], familyAbc: match[3], gmroi,
    xyz: match[5], rotation: match[6], coverage: match[7], affectation: match[8],
    warning: gmroi < 0 || gmroi > 100
  };
}

export function splitInventoryArticle(value: unknown) {
  const raw = text(value);
  // Conserva códigos SAP con prefijo, numéricos y alfanuméricos del archivo fuente.
  const match = /^([A-Z]{1,4}-\d+|[A-Z0-9]+)\s*-\s*(.+)$/i.exec(raw);
  if (!match) throw new Error(`Artículo sin SKU reconocible: ${raw || "vacío"}`);
  return { sku: match[1].toUpperCase(), description: match[2].trim() };
}

function headerMap(worksheet: ExcelJS.Worksheet) {
  const result = new Map<string, number>();
  worksheet.getRow(1).eachCell((cell, column) => result.set(normalizedHeader(cell.value), column));
  return result;
}

function requiredColumn(headers: Map<string, number>, names: string[]) {
  for (const name of names) {
    const column = headers.get(normalizedHeader(name));
    if (column) return column;
  }
  throw new Error(`Falta la columna obligatoria: ${names[0]}`);
}

async function workbookFrom(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  // ExcelJS mantiene una definición Buffer propia que no contempla aún el
  // parámetro genérico incorporado por @types/node 22; en ejecución es el mismo Buffer.
  await workbook.xlsx.load(buffer as never);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("El archivo no contiene hojas");
  return sheet;
}

export async function parseMasterWorkbook(buffer: Buffer): Promise<MasterRow[]> {
  const sheet = await workbookFrom(buffer);
  const headers = headerMap(sheet);
  const columns = {
    line: requiredColumn(headers, ["Linea"]), family: requiredColumn(headers, ["Familia"]),
    brand: requiredColumn(headers, ["Marca"]), sku: requiredColumn(headers, ["SKU"]),
    description: requiredColumn(headers, ["descripcion", "descripcion producto"]),
    card: requiredColumn(headers, ["Cedula"])
  };
  const rows: MasterRow[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const sku = text(row.getCell(columns.sku).value).toUpperCase();
    if (!sku) return;
    try {
      if (seen.has(sku)) throw new Error(`SKU duplicado: ${sku}`);
      seen.add(sku);
      const line = text(row.getCell(columns.line).value);
      const family = text(row.getCell(columns.family).value);
      const brand = text(row.getCell(columns.brand).value);
      const description = text(row.getCell(columns.description).value);
      if (!line || !family || !brand || !description) throw new Error("Campos maestros incompletos");
      rows.push({ sku, line, family, brand, description, card: parseDakaCard(row.getCell(columns.card).value), rowNumber });
    } catch (error) {
      errors.push(`Fila ${rowNumber}: ${error instanceof Error ? error.message : "error desconocido"}`);
    }
  });
  if (errors.length) throw new Error(errors.slice(0, 12).join("\n") + (errors.length > 12 ? `\n…y ${errors.length - 12} errores más` : ""));
  if (!rows.length) throw new Error("El maestro no contiene productos válidos");
  return rows;
}

export async function parseInventoryWorkbook(buffer: Buffer): Promise<InventoryRow[]> {
  const sheet = await workbookFrom(buffer);
  const headers = headerMap(sheet);
  const columns = {
    article: requiredColumn(headers, ["Articulo Completo"]), line: requiredColumn(headers, ["Linea"]),
    brand: requiredColumn(headers, ["marca"]), family: requiredColumn(headers, ["Familia"]),
    subfamily: requiredColumn(headers, ["SubFamilia"]), quantity: requiredColumn(headers, ["Inv Tienda con cdd", "Inv Tienda con cdd Visual"]),
    location: requiredColumn(headers, ["Sucursal_Display"])
  };
  const rows: InventoryRow[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    if (!text(row.getCell(columns.article).value)) return;
    try {
      const article = splitInventoryArticle(row.getCell(columns.article).value);
      const location = normalizeLocation(row.getCell(columns.location).value);
      const quantity = Number(row.getCell(columns.quantity).value);
      if (!location || !Number.isFinite(quantity)) throw new Error("Ubicación o inventario inválido");
      const key = `${article.sku}\u0000${location.toLowerCase()}`;
      if (seen.has(key)) throw new Error(`Registro duplicado para ${article.sku} en ${location}`);
      seen.add(key);
      rows.push({
        ...article, line: text(row.getCell(columns.line).value), brand: text(row.getCell(columns.brand).value),
        family: text(row.getCell(columns.family).value), subfamily: text(row.getCell(columns.subfamily).value),
        quantity, location, rowNumber
      });
    } catch (error) {
      errors.push(`Fila ${rowNumber}: ${error instanceof Error ? error.message : "error desconocido"}`);
    }
  });
  if (errors.length) throw new Error(errors.slice(0, 12).join("\n") + (errors.length > 12 ? `\n…y ${errors.length - 12} errores más` : ""));
  if (!rows.length) throw new Error("El inventario no contiene registros válidos");
  return rows;
}

function parsePriceValue(value: unknown) {
  if (typeof value === "number") return value;
  const raw = text(value).replace(/\s/g, "");
  if (!raw) return Number.NaN;
  const normalized = raw.includes(",") && raw.includes(".")
    ? raw.lastIndexOf(",") > raw.lastIndexOf(".")
      ? raw.replace(/\./g, "").replace(",", ".")
      : raw.replace(/,/g, "")
    : raw.replace(",", ".");
  return Number(normalized.replace(/[^0-9.-]/g, ""));
}

export async function parsePriceListWorkbook(buffer: Buffer): Promise<PriceListRow[]> {
  const sheet = await workbookFrom(buffer);
  const headers = headerMap(sheet);
  const columns = {
    sku: requiredColumn(headers, ["Número de artículo", "Numero de articulo", "SKU"]),
    description: requiredColumn(headers, ["Descripción del artículo", "Descripcion del articulo", "Descripcion"]),
    price: requiredColumn(headers, ["Precio", "Precio USD"])
  };
  const rows: PriceListRow[] = [];
  const seen = new Map<string, number>();
  const errors: string[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const sku = text(row.getCell(columns.sku).value).toUpperCase();
    if (!sku) return;
    try {
      const description = text(row.getCell(columns.description).value);
      const price = parsePriceValue(row.getCell(columns.price).value);
      if (!description) throw new Error("Descripción vacía");
      if (!Number.isFinite(price) || price <= 0) throw new Error("Precio vacío, inválido o menor o igual a cero");
      const previous = seen.get(sku);
      if (previous != null) {
        if (previous !== price) throw new Error(`SKU duplicado con precios diferentes: ${sku}`);
        throw new Error(`SKU duplicado: ${sku}`);
      }
      seen.set(sku, price);
      rows.push({ sku, description, price, rowNumber });
    } catch (error) {
      errors.push(`Fila ${rowNumber}: ${error instanceof Error ? error.message : "error desconocido"}`);
    }
  });
  if (errors.length) throw new Error(errors.slice(0, 12).join("\n") + (errors.length > 12 ? `\n…y ${errors.length - 12} errores más` : ""));
  if (!rows.length) throw new Error("La lista no contiene precios válidos");
  return rows;
}

export function previewMaster(rows: MasterRow[], filename: string): ImportPreview {
  const warnings = rows.filter((row) => row.card.warning).length;
  const newProducts = rows.filter((row) => row.card.raw.includes("N")).length;
  const inactive = rows.filter((row) => row.family.toUpperCase() === "INACTIVO").length;
  return {
    kind: "master", filename, rowCount: rows.length, uniqueSkus: new Set(rows.map((row) => row.sku)).size,
    warnings: warnings ? [`${warnings.toLocaleString("es-VE")} cédulas conservan un GMROI negativo o atípico y se mostrarán con advertencia.`] : [],
    stats: { gmroiWarnings: warnings, newProducts, inactive },
    sample: rows.slice(0, 5).map((row) => ({ sku: row.sku, description: row.description, card: row.card.raw, gmroiWarning: row.card.warning }))
  };
}

export function previewInventory(rows: InventoryRow[], filename: string): ImportPreview {
  const bySku = new Map<string, number>();
  for (const row of rows) bySku.set(row.sku, (bySku.get(row.sku) ?? 0) + row.quantity);
  const negativeRows = rows.filter((row) => row.quantity < 0).length;
  const zeroRows = rows.filter((row) => row.quantity === 0).length;
  return {
    kind: "inventory", filename, rowCount: rows.length, uniqueSkus: bySku.size,
    warnings: negativeRows ? [`${negativeRows.toLocaleString("es-VE")} registros negativos se conservarán y se tratarán como 0 únicamente para disponibilidad comercial.`] : [],
    stats: { locations: new Set(rows.map((row) => row.location)).size, negativeRows, zeroRows },
    sample: rows.slice(0, 5).map((row) => ({ sku: row.sku, description: row.description, location: row.location, quantity: row.quantity }))
  };
}

export function previewPriceList(rows: PriceListRow[], filename: string): ImportPreview {
  const lowPrices = rows.filter((row) => row.price < 1).length;
  const highPrices = rows.filter((row) => row.price >= 10_000).length;
  const warnings: string[] = [];
  if (lowPrices) warnings.push(`${lowPrices.toLocaleString("es-VE")} precios son inferiores a USD 1; se conservarán con advertencia para revisión.`);
  if (highPrices) warnings.push(`${highPrices.toLocaleString("es-VE")} precios son iguales o superiores a USD 10.000; se conservarán con advertencia.`);
  return {
    kind: "price_list", filename, rowCount: rows.length, uniqueSkus: new Set(rows.map((row) => row.sku)).size,
    warnings,
    stats: {
      lowPrices, highPrices,
      minimumPrice: Math.min(...rows.map((row) => row.price)),
      maximumPrice: Math.max(...rows.map((row) => row.price))
    },
    sample: rows.slice(0, 5).map((row) => ({ sku: row.sku, description: row.description, price: row.price }))
  };
}

export function inventoryStatus(rawTotal: number | null, hasRecord: boolean) {
  if (!hasRecord) return "absent" as const;
  if ((rawTotal ?? 0) < 0) return "negative" as const;
  if ((rawTotal ?? 0) === 0) return "zero" as const;
  return "available" as const;
}
