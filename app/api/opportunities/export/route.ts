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
  const query = parseOpportunityQuery(request.nextUrl.searchParams);
  let page;
  try {
    page = await getOpportunityPage(query, true);
  } catch (error) {
    console.error("Opportunity export data query failed", error);
    return NextResponse.json({
      error: "No fue posible consultar las oportunidades para la exportación",
      code: "OPPORTUNITY_DATA_QUERY_FAILED"
    }, { status: 500 });
  }
  try {
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
    console.error(`Opportunity ${format} generation failed`, error);
    return NextResponse.json({
      error: "No fue posible generar la exportación",
      code: format === "pdf" ? "OPPORTUNITY_PDF_GENERATION_FAILED" : "OPPORTUNITY_XLSX_GENERATION_FAILED"
    }, { status: 500 });
  }
}
