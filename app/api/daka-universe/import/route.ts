import { createHash, randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getSql } from "@/lib/db";
import {
  DAKA_CARD_PERIOD,
  DAKA_INVENTORY_EFFECTIVE_DATE,
  parseInventoryWorkbook,
  parseMasterWorkbook,
  previewInventory,
  previewMaster,
  type InventoryRow,
  type MasterRow
} from "@/lib/daka-universe";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CHUNK_SIZE = 750;
const chunks = <T,>(items: T[]) => Array.from({ length: Math.ceil(items.length / CHUNK_SIZE) }, (_, index) => items.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE));

async function readUpload(request: NextRequest) {
  const form = await request.formData();
  const file = form.get("file");
  const kind = String(form.get("kind") ?? "");
  const mode = String(form.get("mode") ?? "preview");
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Selecciona un archivo Excel .xlsx");
  if (kind !== "master" && kind !== "inventory") throw new Error("Tipo de archivo no reconocido");
  if (mode !== "preview" && mode !== "publish") throw new Error("Modo de importación no reconocido");
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!buffer.length || buffer.length > 4_000_000) throw new Error("El archivo debe pesar menos de 4 MB");
  return { file, kind, mode, buffer, checksum: createHash("sha256").update(buffer).digest("hex") } as const;
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
        FROM jsonb_to_recordset(${JSON.stringify(masterPayload)}::jsonb)
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
        FROM jsonb_to_recordset(${JSON.stringify(cardPayload)}::jsonb)
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
        FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb)
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
        SELECT x.name, x.type FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS x(name text, type text)
        ON CONFLICT (name) DO UPDATE SET location_type = EXCLUDED.location_type, active = TRUE
      `;
    }
    for (const part of chunks(rows)) {
      const payload = part.map((row) => ({ sku: row.sku, location: row.location, quantity: row.quantity }));
      await tx`
        INSERT INTO daka_inventory_by_location (snapshot_id, sku, location_id, quantity_raw)
        SELECT ${snapshotId}::uuid, x.sku, l.id, x.quantity
        FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS x(sku text, location text, quantity numeric)
        JOIN daka_locations l ON l.name = x.location
      `;
    }
  });
  return batchId;
}

export async function POST(request: NextRequest) {
  const user = await getRequestUser(request);
  if (user?.role !== "admin") return NextResponse.json({ error: "Acceso administrativo requerido" }, { status: 403 });
  try {
    const upload = await readUpload(request);
    const rows = upload.kind === "master" ? await parseMasterWorkbook(upload.buffer) : await parseInventoryWorkbook(upload.buffer);
    const preview = upload.kind === "master"
      ? previewMaster(rows as MasterRow[], upload.file.name)
      : previewInventory(rows as InventoryRow[], upload.file.name);
    if (upload.mode === "preview") return NextResponse.json({ preview });
    const batchId = upload.kind === "master"
      ? await publishMaster(rows as MasterRow[], upload.file.name, upload.checksum, user)
      : await publishInventory(rows as InventoryRow[], upload.file.name, upload.checksum, user);
    return NextResponse.json({ preview, batchId, published: true });
  } catch (error) {
    console.error("Daka universe import failed", error);
    const message = error instanceof Error ? error.message : "No fue posible procesar el archivo";
    const duplicate = message.includes("duplicate key") || message.includes("daka_import_batches_file_type_checksum");
    return NextResponse.json({ error: duplicate ? "Este archivo ya fue publicado anteriormente; no se duplicaron datos." : message }, { status: duplicate ? 409 : 400 });
  }
}
