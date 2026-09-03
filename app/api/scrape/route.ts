import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export async function POST(request: NextRequest) {
  const configuredKey = process.env.ADMIN_API_KEY;
  const suppliedKey = request.headers.get("x-admin-key");
  if (!configuredKey || suppliedKey !== configuredKey) {
    return NextResponse.json({ error: "Clave administrativa inválida" }, { status: 401 });
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
