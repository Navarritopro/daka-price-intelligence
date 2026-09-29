import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { isAdminRequest } from "@/lib/auth";

export async function POST(request: NextRequest) {
  if (!await isAdminRequest(request)) {
    return NextResponse.json({ error: "Acceso administrativo requerido" }, { status: 403 });
  }

  try {
    const sql = getSql();
    const [pending] = await sql`
      SELECT id
      FROM scrape_requests
      WHERE status IN ('queued', 'running')
      ORDER BY requested_at DESC
      LIMIT 1
    `;
    if (pending) {
      return NextResponse.json(
        { error: "Ya existe una solicitud pendiente o una ejecución manual activa" },
        { status: 409 }
      );
    }
    const [requestRow] = await sql`
      INSERT INTO scrape_requests (status)
      VALUES ('queued')
      RETURNING id, requested_at
    `;
    return NextResponse.json({ accepted: true, request: requestRow }, { status: 202 });
  } catch (error) {
    console.error("Local scrape request failed", error);
    return NextResponse.json({ error: "No fue posible registrar la solicitud local" }, { status: 500 });
  }
}
