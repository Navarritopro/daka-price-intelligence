import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sql = getSql();
    const [row] = await sql`
      SELECT id, status, requested_at, claimed_at, finished_at, error_message
      FROM scrape_requests
      ORDER BY requested_at DESC
      LIMIT 1
    `;
    if (!row) return NextResponse.json(null);
    return NextResponse.json({
      id: String(row.id),
      status: row.status,
      requestedAt: row.requested_at,
      claimedAt: row.claimed_at,
      finishedAt: row.finished_at,
      errorMessage: row.error_message
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "No fue posible consultar la solicitud manual" }, { status: 500 });
  }
}
