import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import {
  inventoryStatus,
  normalizeLocation,
  parseDakaCard,
  parseInventoryWorkbook,
  parseMasterWorkbook,
  parsePriceListWorkbook,
  previewInventory,
  previewMaster,
  previewPriceList,
  splitInventoryArticle
} from "../lib/daka-universe.ts";

test("decodifica la cédula sin modificar el valor original", () => {
  const card = parseDakaCard("AAA12,94YLDP");
  assert.equal(card.raw, "AAA12,94YLDP");
  assert.deepEqual([card.companyAbc, card.lineAbc, card.familyAbc], ["A", "A", "A"]);
  assert.equal(card.gmroi, 12.94);
  assert.deepEqual([card.xyz, card.rotation, card.coverage, card.affectation], ["Y", "L", "D", "P"]);
});

test("valida la lista diaria de precios y conserva valores extremos como advertencias", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("base otras");
  sheet.addRow(["Número de artículo", "Descripción del artículo", "Precio"]);
  sheet.addRow(["LB-1", "ACCESORIO", 0.01]);
  sheet.addRow(["LB-2", "EQUIPO ESPECIAL", 24499.99]);
  const rows = await parsePriceListWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()));
  const preview = previewPriceList(rows, "precios.xlsx");
  assert.equal(preview.uniqueSkus, 2);
  assert.equal(preview.stats.lowPrices, 1);
  assert.equal(preview.stats.highPrices, 1);
  assert.equal(preview.warnings.length, 2);
});

test("rechaza SKU duplicados o precios no positivos en la lista diaria", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("base otras");
  sheet.addRow(["Número de artículo", "Descripción del artículo", "Precio"]);
  sheet.addRow(["LB-1", "PRODUCTO", 100]);
  sheet.addRow(["LB-1", "PRODUCTO", 90]);
  sheet.addRow(["LB-2", "PRODUCTO DOS", 0]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  await assert.rejects(
    () => parsePriceListWorkbook(buffer),
    /SKU duplicado con precios diferentes|Precio vacío/
  );
});

test("preserva GMROI negativo y marca valores atípicos", () => {
  const card = parseDakaCard("BCN-4,8NNNN");
  assert.equal(card.gmroi, -4.8);
  assert.equal(card.warning, true);
  assert.equal(card.raw, "BCN-4,8NNNN");
});

test("N permanece disponible para producto nuevo o pocas ventas", () => {
  const card = parseDakaCard("NNN0NNNN");
  assert.equal(card.companyAbc, "N");
  assert.equal(card.xyz, "N");
});

test("distingue ausencia, cero, negativo y disponibilidad", () => {
  assert.equal(inventoryStatus(null, false), "absent");
  assert.equal(inventoryStatus(0, true), "zero");
  assert.equal(inventoryStatus(-3, true), "negative");
  assert.equal(inventoryStatus(12, true), "available");
});

test("normaliza espacios de ubicación y separa artículo", () => {
  assert.equal(normalizeLocation("Sucursal\u00a0San Felipe  "), "Sucursal San Felipe");
  assert.deepEqual(splitInventoryArticle("LB-00000075 - CENTRO D/LAVADO"), { sku: "LB-00000075", description: "CENTRO D/LAVADO" });
});

test("valida y resume libros maestro e inventario", async () => {
  const masterBook = new ExcelJS.Workbook();
  const masterSheet = masterBook.addWorksheet("Hoja1");
  masterSheet.addRow(["Linea", "Familia", "Marca", "SKU", "descripcion", "Cedula"]);
  masterSheet.addRow(["Linea Blanca", "HORNOS", "MARCA", "LB-1", "HORNO", "AAA12,94YLDP"]);
  const masterRows = await parseMasterWorkbook(Buffer.from(await masterBook.xlsx.writeBuffer()));
  assert.equal(previewMaster(masterRows, "maestro.xlsx").uniqueSkus, 1);

  const inventoryBook = new ExcelJS.Workbook();
  const inventorySheet = inventoryBook.addWorksheet("Sheet1");
  inventorySheet.addRow(["Articulo Completo", "Línea", "marca", "Familia", "SubFamilia", "Inv Tienda con cdd", "Sucursal_Display"]);
  inventorySheet.addRow(["LB-1 - HORNO", "Blanca", "MARCA", "HORNOS", "HORNOS 26", -2, "CDD"]);
  const inventoryRows = await parseInventoryWorkbook(Buffer.from(await inventoryBook.xlsx.writeBuffer()));
  const preview = previewInventory(inventoryRows, "inventario.xlsx");
  assert.equal(preview.uniqueSkus, 1);
  assert.equal(preview.stats.negativeRows, 1);
});

test("acepta el nuevo formato Visual y conserva códigos numéricos y alfanuméricos", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Sheet1");
  // Columnas reordenadas, acentos y espacios: la asociación depende del encabezado.
  sheet.addRow(["Sucursal_Display", "Inv Tienda con cdd Visual ", "Articulo Completo", "Línea", "marca", "Familia", "SubFamilia"]);
  sheet.addRow(["CDD", -2, "408488906 - PROYECTOR", "Digital", "MARCA", "FAMILIA", ""]);
  sheet.addRow(["Tienda", 0, "540W2668201A7191320289 - HY13RM3", "Digital", "MARCA", "FAMILIA", ""]);
  sheet.addRow(["CDD", 3, "LB-00000075 - CENTRO - LAVADO", "Blanca", "MARCA", "FAMILIA", "SUB"]);
  sheet.addRow(["CDD", 1, "000123 - PRODUCTO", "Digital", "MARCA", "FAMILIA", ""]);
  const rows = await parseInventoryWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  assert.deepEqual(rows.map(row => row.sku), ["408488906", "540W2668201A7191320289", "LB-00000075", "000123"]);
  assert.deepEqual(rows.map(row => row.quantity), [-2, 0, 3, 1]);
  assert.equal(rows[2].description, "CENTRO - LAVADO");
  assert.equal(rows[0].subfamily, "");
  assert.equal(previewInventory(rows, "nuevo.xlsx").uniqueSkus, 4);
});

test("el nuevo formato sigue rechazando duplicados, artículos y cantidades inválidas", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Sheet1");
  sheet.addRow(["Articulo Completo", "Línea", "marca", "Familia", "SubFamilia", "Inv Tienda con cdd Visual", "Sucursal_Display"]);
  sheet.addRow(["408488906 - PRODUCTO", "Digital", "MARCA", "FAMILIA", "", 1, "CDD"]);
  sheet.addRow(["408488906 - PRODUCTO", "Digital", "MARCA", "FAMILIA", "", 2, "CDD"]);
  sheet.addRow(["408488907 - PRODUCTO", "Digital", "MARCA", "FAMILIA", "", "inválido", "CDD"]);
  sheet.addRow(["SIN SEPARADOR", "Digital", "MARCA", "FAMILIA", "", 1, "CDD"]);
  const buffer = Buffer.from(await book.xlsx.writeBuffer());
  await assert.rejects(() => parseInventoryWorkbook(buffer), error => {
    assert.match(error.message, /Registro duplicado/);
    assert.match(error.message, /Ubicación o inventario inválido/);
    assert.match(error.message, /Artículo sin SKU reconocible/);
    return true;
  });
});
