import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const configuredKey = process.env.ADMIN_API_KEY;
  const suppliedKey = request.headers.get("x-admin-key");
  if (!configuredKey || suppliedKey !== configuredKey) {
    return NextResponse.json({ error: "Clave administrativa inválida" }, { status: 401 });
  }

  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  const workflow = process.env.GITHUB_WORKFLOW_FILE ?? "scrape.yml";
  if (!owner || !repo || !token) {
    return NextResponse.json({ error: "La integración con GitHub no está configurada" }, { status: 500 });
  }

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ref: "main", inputs: { trigger_type: "manual" } }),
      cache: "no-store"
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    console.error("GitHub dispatch failed", response.status, detail);
    return NextResponse.json({ error: "GitHub no aceptó la ejecución" }, { status: 502 });
  }
  return NextResponse.json({ accepted: true }, { status: 202 });
}
