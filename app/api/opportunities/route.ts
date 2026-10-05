import { NextRequest, NextResponse } from "next/server";
import { getOpportunityPage, parseOpportunityQuery } from "@/lib/opportunities-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const query = parseOpportunityQuery(request.nextUrl.searchParams);
    return NextResponse.json(await getOpportunityPage(query));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "No fue posible calcular las oportunidades comerciales" }, { status: 500 });
  }
}
