import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { getOpportunityPage, parseOpportunityQuery } from "@/lib/opportunities-service";
import { buildOpportunityPdf, buildOpportunityTelegramCaption, opportunityReportFilename } from "@/lib/opportunity-reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!await isAdminRequest(request)) {
    return NextResponse.json({ error: "Acceso administrativo requerido" }, { status: 403 });
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return NextResponse.json({ error: "Falta configurar TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en Vercel" }, { status: 503 });
  }
  try {
    const body = await request.json() as { searchParams?: unknown };
    const searchParams = typeof body.searchParams === "string" ? body.searchParams : "";
    const query = parseOpportunityQuery(new URLSearchParams(searchParams));
    const page = await getOpportunityPage(query, true);
    if (!page.items.length) {
      return NextResponse.json({ error: "No existen oportunidades con los filtros seleccionados" }, { status: 400 });
    }
    const pdf = await buildOpportunityPdf(page, query);
    const origin = process.env.APP_BASE_URL
      ?? process.env.NEXT_PUBLIC_APP_URL
      ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : request.nextUrl.origin);
    const form = new FormData();
    form.set("chat_id", chatId);
    form.set("caption", buildOpportunityTelegramCaption(page, query));
    form.set("document", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), opportunityReportFilename("pdf"));
    form.set("reply_markup", JSON.stringify({ inline_keyboard: [[{ text: "Abrir Centro de Oportunidades", url: `${origin}/?priceTab=opportunities` }]] }));
    const telegramResponse = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: "POST", body: form, cache: "no-store"
    });
    if (!telegramResponse.ok) {
      const detail = await telegramResponse.text();
      console.error("Opportunity PDF Telegram delivery failed", telegramResponse.status, detail);
      return NextResponse.json({ error: "Telegram no pudo recibir el PDF. Verifica el bot y el grupo configurado." }, { status: 502 });
    }
    return NextResponse.json({ sent: true, total: page.total });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "No fue posible enviar el reporte de oportunidades" }, { status: 500 });
  }
}
