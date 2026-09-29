import { NextRequest, NextResponse } from "next/server";

const WORKFLOW_FILE = "competitor-price-report.yml";

export async function POST(request: NextRequest) {
  const configuredKey = process.env.ADMIN_API_KEY;
  const suppliedKey = request.headers.get("x-admin-key");
  if (!configuredKey || suppliedKey !== configuredKey) {
    return NextResponse.json({ error: "Clave administrativa inválida" }, { status: 401 });
  }

  const owner = process.env.GITHUB_OWNER;
  const repository = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  if (!owner || !repository || !token) {
    return NextResponse.json(
      { error: "Falta configurar GITHUB_OWNER, GITHUB_REPO o GITHUB_TOKEN en Vercel" },
      { status: 503 }
    );
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repository}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ ref: "main" }),
        cache: "no-store"
      }
    );

    if (!response.ok) {
      const detail = await response.text();
      console.error("Telegram report dispatch failed", response.status, detail);
      return NextResponse.json(
        { error: "GitHub no pudo iniciar el reporte. Verifica el token y sus permisos de Actions." },
        { status: 502 }
      );
    }

    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch (error) {
    console.error("Telegram report request failed", error);
    return NextResponse.json({ error: "No fue posible solicitar el reporte a GitHub" }, { status: 500 });
  }
}
