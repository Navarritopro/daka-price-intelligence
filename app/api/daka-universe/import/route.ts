import { createHash, randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { MAX_UNIVERSE_FILE_BYTES, readBoundedBody, validateUniverseFileSize } from "@/lib/universe-upload-limits";
import {
  DAKA_CARD_PERIOD,
  DAKA_INVENTORY_EFFECTIVE_DATE,
  parseInventoryWorkbook,
  parseMasterWorkbook,
  parsePriceListWorkbook,
  previewInventory,
  previewMaster,
  previewPriceList,
  type InventoryRow,
  type MasterRow,
  type PriceListRow
} from "@/lib/daka-universe";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CHUNK_SIZE = 750;
const chunks = <T,>(items: T[]) => Array.from({ length: Math.ceil(items.length / CHUNK_SIZE) }, (_, index) => items.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE));

async function readUpload(request: NextRequest, ownerId: string) {
  const kind = request.headers.get("x-import-kind") ?? "";
  const mode = request.headers.get("x-import-mode") ?? "preview";
  const encodedFilename = request.headers.get("x-file-name") ?? "";
  let filename = encodedFilename;
  try { filename = decodeURIComponent(encodedFilename); } catch { /* conserva el nombre recibido */ }
  if (!filename.toLowerCase().endsWith(".xlsx")) throw new Error("Selecciona un archivo Excel .xlsx");
  if (kind !== "master" && kind !== "inventory" && kind !== "price_list") throw new Error("Tipo de archivo no reconocido");
  if (mode !== "preview" && mode !== "publish") throw new Error("Modo de importación no reconocido");
  const uploadId = request.headers.get("x-upload-id");
  let buffer: Buffer;
  if (uploadId) {
    if (!/^[0-9a-f-]{36}$/i.test(uploadId)) throw new Error("Identificador de carga inválido");
    const sql = getSql();
    const [stored] = await sql`DELETE FROM daka_universe_upload_staging
      WHERE id = ${uploadId}::uuid AND owner_id = ${ownerId}::uuid
        AND expires_at > NOW() AND octet_length(data) = total_bytes
      RETURNING data`;
    if (!stored) throw new Error("La carga está incompleta o vencida. Vuelve a validar el archivo.");
    buffer = Buffer.from(stored.data);
  } else {
    buffer = Buffer.from(await readBoundedBody(request, MAX_UNIVERSE_FILE_BYTES));
  }
  validateUniverseFileSize(buffer.length);
  const effectiveDate = request.headers.get("x-effective-date")?.trim() ?? "";
  if (kind === "price_list" && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    throw new Error("Indica una fecha efectiva válida para la lista de precios");
  }
  return { filename, kind, mode, effectiveDate, buffer, checksum: createHash("sha256").update(buffer).digest("hex") } as const;
}

async function enrichPricePreview(preview: ReturnType<typeof previewPriceList>, rows: PriceListRow[]) {
  const sql = getSql();
  const skus = rows.map((row) => row.sku);
  const [coverage] = await sql`
    WITH incoming AS (
      SELECT jsonb_array_elements_text(${sql.json(skus)}::jsonb) AS sku
    )
    SELECT
      COUNT(*) FILTER (WHERE m.sku IS NOT NULL)::int AS matched_universe,
      COUNT(*) FILTER (WHERE m.master_present)::int AS matched_master,
      COUNT(*) FILTER (WHERE m.sku IS NULL)::int AS price_only,
      (SELECT COUNT(*) FROM daka_sku_master dm WHERE NOT EXISTS (SELECT 1 FROM incoming i WHERE i.sku = dm.sku))::int AS universe_without_price
    FROM incoming i LEFT JOIN daka_sku_master m ON m.sku = i.sku
  `;
  preview.stats = {
    ...preview.stats,
    matchedUniverse: Number(coverage?.matched_universe ?? 0),
    matchedMaster: Number(coverage?.matched_master ?? 0),
    priceOnly: Number(coverage?.price_only ?? 0),
    universeWithoutPrice: Number(coverage?.universe_without_price ?? 0)
  };
  if (preview.stats.priceOnly) preview.warnings.push(`${preview.stats.priceOnly.toLocaleString("es-VE")} SKU aparecen solo en la lista de precios; se conservarán para auditoría sin agregarlos automáticamente al universo.`);
  if (preview.stats.universeWithoutPrice) preview.warnings.push(`${preview.stats.universeWithoutPrice.toLocaleString("es-VE")} SKU del universo no tienen precio en este archivo.`);
  return preview;
}

async function publishMaster(rows: MasterRow[], filename: string, checksum: string, user: { id: string; email: string }) {
  const sql = getSql();
  const batchId = randomUUID();
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO daka_import_batches
        (id, file_type, filename, checksum_sha256, effective_date, period_month, row_count, unique_skus, warning_count, imported_by, imported_by_email)
      VALUES (${batchId}, 'master', ${filename}, ${checksum}, ${DAKA_CARD_PERIOD}::date, ${DAKA_CARD_PERIOD}::date,
        ${rows.length}, ${new Set(rows.map((row) => row.sku)).size}, ${rows.filter((row) => row.card.warning).length}, ${user.id}::uuid, ${user.email})
    `;
    for (const part of chunks(rows)) {
      const masterPayload = part.map((row) => ({
        sku: row.sku, line: row.line, family: row.family, brand: row.brand,
        description: row.description, active: row.family.toUpperCase() !== "INACTIVO"
      }));
      await tx`
        INSERT INTO daka_sku_master (sku, line, family, brand, description, master_present, active, source_batch_id, updated_at)
        SELECT x.sku, x.line, x.family, x.brand, x.description, TRUE, x.active, ${batchId}::uuid, NOW()
        FROM jsonb_to_recordset(${tx.json(masterPayload)}::jsonb)
          AS x(sku text, line text, family text, brand text, description text, active boolean)
        ON CONFLICT (sku) DO UPDATE SET line = EXCLUDED.line, family = EXCLUDED.family,
          brand = EXCLUDED.brand, description = EXCLUDED.description, master_present = TRUE,
          active = EXCLUDED.active, source_batch_id = EXCLUDED.source_batch_id, updated_at = NOW()
      `;
      const cardPayload = part.map((row) => ({
        sku: row.sku, raw: row.card.raw, company: row.card.companyAbc, line: row.card.lineAbc,
        family: row.card.familyAbc, gmroi: row.card.gmroi, xyz: row.card.xyz,
        rotation: row.card.rotation, coverage: row.card.coverage, affectation: row.card.affectation,
        warning: row.card.warning
      }));
      await tx`
        INSERT INTO daka_sku_card_history
          (sku, period_month, card_raw, company_abc, line_abc, family_abc, gmroi, xyz, rotation, coverage, affectation, gmroi_warning, source_batch_id)
        SELECT x.sku, ${DAKA_CARD_PERIOD}::date, x.raw, x.company, x.line, x.family, x.gmroi,
          x.xyz, x.rotation, x.coverage, x.affectation, x.warning, ${batchId}::uuid
        FROM jsonb_to_recordset(${tx.json(cardPayload)}::jsonb)
          AS x(sku text, raw text, company text, line text, family text, gmroi numeric, xyz text, rotation text, coverage text, affectation text, warning boolean)
        ON CONFLICT (sku, period_month) DO UPDATE SET card_raw = EXCLUDED.card_raw,
          company_abc = EXCLUDED.company_abc, line_abc = EXCLUDED.line_abc, family_abc = EXCLUDED.family_abc,
          gmroi = EXCLUDED.gmroi, xyz = EXCLUDED.xyz, rotation = EXCLUDED.rotation,
          coverage = EXCLUDED.coverage, affectation = EXCLUDED.affectation,
          gmroi_warning = EXCLUDED.gmroi_warning, source_batch_id = EXCLUDED.source_batch_id, created_at = NOW()
      `;
    }
  });
  return batchId;
}

async function publishInventory(rows: InventoryRow[], filename: string, checksum: string, user: { id: string; email: string }) {
  const sql = getSql();
  const batchId = randomUUID();
  const snapshotId = randomUUID();
  const provisional = new Map<string, InventoryRow>();
  for (const row of rows) if (!provisional.has(row.sku)) provisional.set(row.sku, row);
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO daka_import_batches
        (id, file_type, filename, checksum_sha256, effective_date, row_count, unique_skus, warning_count, imported_by, imported_by_email)
      VALUES (${batchId}, 'inventory', ${filename}, ${checksum}, ${DAKA_INVENTORY_EFFECTIVE_DATE}::date,
        ${rows.length}, ${provisional.size}, ${rows.filter((row) => row.quantity < 0).length}, ${user.id}::uuid, ${user.email})
    `;
    for (const part of chunks([...provisional.values()])) {
      const payload = part.map((row) => ({
        sku: row.sku, line: row.line ? `Linea ${row.line}` : "Sin línea",
        family: row.family || "Sin familia", subfamily: row.subfamily || null,
        brand: row.brand || "Sin marca definida", description: row.description
      }));
      await tx`
        INSERT INTO daka_sku_master (sku, line, family, subfamily, brand, description, master_present, active, source_batch_id)
        SELECT x.sku, x.line, x.family, x.subfamily, x.brand, x.description, FALSE, TRUE, ${batchId}::uuid
        FROM jsonb_to_recordset(${tx.json(payload)}::jsonb)
          AS x(sku text, line text, family text, subfamily text, brand text, description text)
        ON CONFLICT (sku) DO UPDATE SET subfamily = COALESCE(EXCLUDED.subfamily, daka_sku_master.subfamily), updated_at = NOW()
      `;
    }
    await tx`INSERT INTO daka_inventory_snapshots (id, effective_date, source_batch_id) VALUES (${snapshotId}, ${DAKA_INVENTORY_EFFECTIVE_DATE}::date, ${batchId}::uuid)`;
    const locations = [...new Set(rows.map((row) => row.location))];
    for (const part of chunks(locations)) {
      const payload = part.map((name) => ({ name, type: name.toUpperCase() === "CDD" ? "cdd" : "store" }));
      await tx`
        INSERT INTO daka_locations (name, location_type)
        SELECT x.name, x.type FROM jsonb_to_recordset(${tx.json(payload)}::jsonb) AS x(name text, type text)
        ON CONFLICT (name) DO UPDATE SET location_type = EXCLUDED.location_type, active = TRUE
      `;
    }
    for (const part of chunks(rows)) {
      const payload = part.map((row) => ({ sku: row.sku, location: row.location, quantity: row.quantity }));
      await tx`
        INSERT INTO daka_inventory_by_location (snapshot_id, sku, location_id, quantity_raw)
        SELECT ${snapshotId}::uuid, x.sku, l.id, x.quantity
        FROM jsonb_to_recordset(${tx.json(payload)}::jsonb) AS x(sku text, location text, quantity numeric)
        JOIN daka_locations l ON l.name = x.location
      `;
    }
  });
  return batchId;
}

async function publishPriceList(rows: PriceListRow[], filename: string, checksum: string, effectiveDate: string, user: { id: string; email: string }) {
  const sql = getSql();
  const batchId = randomUUID();
  const snapshotId = randomUUID();
  const warningCount = rows.filter((row) => row.price < 1 || row.price >= 10_000).length;
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`daka-price:${effectiveDate}:base-otras`}))`;
    const [versionRow] = await tx`
      SELECT COALESCE(MAX(version), 0)::int + 1 AS next_version
      FROM daka_price_snapshots
      WHERE effective_date = ${effectiveDate}::date AND list_name = 'base otras'
    `;
    const version = Number(versionRow?.next_version ?? 1);
    await tx`
      INSERT INTO daka_import_batches
        (id, file_type, filename, checksum_sha256, effective_date, row_count, unique_skus, warning_count, imported_by, imported_by_email)
      VALUES (${batchId}, 'price_list', ${filename}, ${checksum}, ${effectiveDate}::date,
        ${rows.length}, ${rows.length}, ${warningCount}, ${user.id}::uuid, ${user.email})
    `;
    await tx`
      INSERT INTO daka_price_snapshots
        (id, effective_date, currency, list_name, version, is_active, source_batch_id)
      VALUES (${snapshotId}, ${effectiveDate}::date, 'USD', 'base otras', ${version}, FALSE, ${batchId}::uuid)
    `;
    for (const part of chunks(rows)) {
      const payload = part.map((row) => ({
        sku: row.sku, description: row.description, price: row.price,
        warning: row.price < 1 || row.price >= 10_000
      }));
      await tx`
        INSERT INTO daka_price_items (snapshot_id, sku, source_description, price_usd, review_warning)
        SELECT ${snapshotId}::uuid, x.sku, x.description, x.price, x.warning
        FROM jsonb_to_recordset(${tx.json(payload)}::jsonb)
          AS x(sku text, description text, price numeric, warning boolean)
      `;
    }
    const previous = await tx`
      UPDATE daka_price_snapshots SET is_active = FALSE, replaced_by = ${snapshotId}::uuid
      WHERE effective_date = ${effectiveDate}::date AND list_name = 'base otras' AND is_active = TRUE
      RETURNING id
    `;
    await tx`UPDATE daka_price_snapshots SET is_active = TRUE WHERE id = ${snapshotId}::uuid`;
    return previous;
  });
  return batchId;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (user?.role !== "admin") return NextResponse.json({ error: "Acceso administrativo requerido" }, { status: 403 });
    const upload = await readUpload(request, user.id);
    const rows = upload.kind === "master"
      ? await parseMasterWorkbook(upload.buffer)
      : upload.kind === "inventory"
        ? await parseInventoryWorkbook(upload.buffer)
        : await parsePriceListWorkbook(upload.buffer);
    const preview = upload.kind === "master"
      ? previewMaster(rows as MasterRow[], upload.filename)
      : upload.kind === "inventory"
        ? previewInventory(rows as InventoryRow[], upload.filename)
        : await enrichPricePreview(previewPriceList(rows as PriceListRow[], upload.filename), rows as PriceListRow[]);
    if (upload.mode === "preview") return NextResponse.json({ preview });
    const batchId = upload.kind === "master"
      ? await publishMaster(rows as MasterRow[], upload.filename, upload.checksum, user)
      : upload.kind === "inventory"
        ? await publishInventory(rows as InventoryRow[], upload.filename, upload.checksum, user)
        : await publishPriceList(rows as PriceListRow[], upload.filename, upload.checksum, upload.effectiveDate, user);
    return NextResponse.json({ preview, batchId, published: true });
  } catch (error) {
    console.error("Daka universe import failed", error);
    const message = error instanceof Error ? error.message : "No fue posible procesar el archivo";
    const duplicate = message.includes("duplicate key") || message.includes("daka_import_batches_file_type_checksum");
    const connectionFailure = /connect|connection|ECONN|timeout|remaining connection slots|too many clients/i.test(message);
    const errorMessage = duplicate
      ? "Este archivo ya fue publicado anteriormente; no se duplicaron datos."
      : connectionFailure
        ? "PostgreSQL no tiene conexiones disponibles. Espera el nuevo despliegue de Vercel y vuelve a intentarlo."
        : message;
    return NextResponse.json({ error: errorMessage }, { status: duplicate ? 409 : connectionFailure ? 503 : 400 });
  }
}

