import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { parsePriceAdjustment } from "@/lib/price-adjustment";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  if (!await getRequestUser(request)) return NextResponse.json({ error: "Sesión requerida" }, { status: 401, headers });
  try {
    const sql = getSql();
    const [row] = await sql`SELECT enabled, percentage FROM price_display_adjustments WHERE source_slug = 'venelectronics'`;
    if (!row) throw new Error("Configuración no preparada");
    return NextResponse.json({ enabled: row.enabled, percentage: Number(row.percentage) }, { headers });
  } catch {
    return NextResponse.json({ error: "Ejecuta primero el workflow Preparar ajuste de precio Venelectronics." }, { status: 503, headers });
  }
}

export async function PUT(request: NextRequest) {
  const user = await getRequestUser(request);
  if (user?.role !== "admin") return NextResponse.json({ error: "Acceso administrativo requerido" }, { status: 403, headers });
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: "Origen no permitido" }, { status: 403, headers });
  let settings;
  try { settings = parsePriceAdjustment(await request.json()); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Solicitud inválida" }, { status: 400, headers }); }
  try {
    const sql = getSql();
    const [saved] = await sql`UPDATE price_display_adjustments SET enabled = ${settings.enabled}, percentage = ${settings.percentage}
      WHERE source_slug = 'venelectronics' RETURNING enabled, percentage`;
    if (!saved) throw new Error("Configuración no preparada");
    return NextResponse.json({ enabled: saved.enabled, percentage: Number(saved.percentage) }, { headers });
  } catch {
    return NextResponse.json({ error: "No se pudo guardar el ajuste. Comprueba que el workflow de preparación terminó correctamente." }, { status: 503, headers });
  }
}
