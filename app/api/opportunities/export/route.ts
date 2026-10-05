import { NextRequest, NextResponse } from "next/server";
import { getOpportunityPage, parseOpportunityQuery } from "@/lib/opportunities-service";
import { buildOpportunityExcel, buildOpportunityPdf, opportunityReportFilename } from "@/lib/opportunity-reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const format = request.nextUrl.searchParams.get("format");
  if (format !== "xlsx" && format !== "pdf") {
    return NextResponse.json({ error: "Formato de exportación no válido" }, { status: 400 });
  }
  try {
    const query = parseOpportunityQuery(request.nextUrl.searchParams);
    const page = await getOpportunityPage(query, true);
    const buffer = format === "xlsx"
      ? await buildOpportunityExcel(page, query)
      : await buildOpportunityPdf(page, query);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": format === "xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "application/pdf",
        "Content-Disposition": `attachment; filename="${opportunityReportFilename(format)}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "No fue posible generar la exportación" }, { status: 500 });
  }
}
