import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { readBoundedBody, UNIVERSE_UPLOAD_PART_BYTES, validateUploadPart } from "@/lib/universe-upload-limits";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (user?.role !== "admin") return NextResponse.json({ error: "Acceso administrativo requerido" }, { status: 403 });
    const id = request.headers.get("x-upload-id") ?? "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error("Identificador de carga inválido");
    const offset = Number(request.headers.get("x-upload-offset") ?? NaN);
    const total = Number(request.headers.get("x-upload-total") ?? NaN);
    const body = Buffer.from(await readBoundedBody(request, UNIVERSE_UPLOAD_PART_BYTES));
    validateUploadPart(offset, total, body.length);
    const sql = getSql();
    if (offset === 0) {
      // Persistent staging: works across different serverless instances. No local disk or process cache.
      await sql`CREATE TABLE IF NOT EXISTS daka_universe_upload_staging (
        id uuid PRIMARY KEY, owner_id uuid NOT NULL, total_bytes integer NOT NULL CHECK (total_bytes BETWEEN 1 AND 5242880),
        data bytea NOT NULL CHECK (octet_length(data) <= 5242880),
        expires_at timestamptz NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes')
      )`;
      await sql`DELETE FROM daka_universe_upload_staging WHERE expires_at < NOW()`;
      // Limit abandoned uploads per administrator as well as total file size.
      await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtext(${`universe-upload:${user.id}`}))`;
        const [count] = await tx`SELECT COUNT(*)::int AS n FROM daka_universe_upload_staging WHERE owner_id = ${user.id}::uuid`;
        if (Number(count.n) >= 5) throw new Error("Hay varias cargas pendientes. Espera 30 minutos y vuelve a intentarlo.");
        await tx`INSERT INTO daka_universe_upload_staging (id, owner_id, total_bytes, data)
          VALUES (${id}::uuid, ${user.id}::uuid, ${total}, ${body})`;
      });
      return NextResponse.json({ received: body.length });
    }
    const updated = await sql`UPDATE daka_universe_upload_staging SET data = data || ${body}::bytea
      WHERE id = ${id}::uuid AND owner_id = ${user.id}::uuid AND total_bytes = ${total}
        AND expires_at > NOW() AND octet_length(data) = ${offset}
      RETURNING octet_length(data) AS received`;
    if (!updated.length) throw new Error("Carga vencida o parte fuera de orden. Vuelve a validar el archivo.");
    return NextResponse.json({ received: Number(updated[0].received) });
  } catch (error) {
    console.error("Universe upload failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible subir el archivo" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (user?.role !== "admin") return NextResponse.json({ error: "Acceso administrativo requerido" }, { status: 403 });
    const id = request.headers.get("x-upload-id") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Identificador inválido");
    const sql = getSql();
    await sql`DELETE FROM daka_universe_upload_staging WHERE id = ${id}::uuid AND owner_id = ${user.id}::uuid`;
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Universe upload cleanup failed", error);
    return NextResponse.json({ error: "No fue posible limpiar la carga temporal" }, { status: 400 });
  }
}
