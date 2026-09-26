import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sql = getSql();
    await sql`SELECT 1 AS ok`;

    return NextResponse.json({
      status: "ok",
      database: "connected"
    });
  } catch (error) {
    console.error("Health check database connection failed", error);

    return NextResponse.json(
      {
        status: "error",
        database: "unavailable"
      },
      { status: 503 }
    );
  }
}
