import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getSql } from "@/lib/db";
import {
  ONBOARDING_VERSION,
  isOnboardingStatus,
  isOnboardingTourKey
} from "@/lib/onboarding";

export async function GET(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sesión requerida" }, { status: 401 });

  try {
    const sql = getSql();
    const [preference] = await sql`
      SELECT onboarding_mode
      FROM app_users
      WHERE id = ${user.id}::uuid
      LIMIT 1
    `;
    const progress = await sql`
      SELECT
        tour_key,
        tour_version,
        status,
        last_step,
        next_prompt_at,
        completed_at,
        updated_at
      FROM app_onboarding_progress
      WHERE user_id = ${user.id}::uuid
      ORDER BY updated_at DESC
    `;

    return NextResponse.json({
      mode: preference?.onboarding_mode === "optional" ? "optional" : "automatic",
      version: ONBOARDING_VERSION,
      progress: progress.map((item) => ({
        tourKey: String(item.tour_key),
        tourVersion: Number(item.tour_version),
        status: String(item.status),
        lastStep: Number(item.last_step),
        nextPromptAt: item.next_prompt_at ? new Date(item.next_prompt_at).toISOString() : null,
        completedAt: item.completed_at ? new Date(item.completed_at).toISOString() : null,
        updatedAt: new Date(item.updated_at).toISOString()
      }))
    });
  } catch (error) {
    console.error("Onboarding GET failed", error);
    return NextResponse.json(
      { error: "El onboarding aún no está preparado en la base de datos" },
      { status: 503 }
    );
  }
}

export async function POST(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sesión requerida" }, { status: 401 });

  let payload: { tourKey?: unknown; status?: unknown; lastStep?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  if (!isOnboardingTourKey(payload.tourKey) || !isOnboardingStatus(payload.status)) {
    return NextResponse.json({ error: "Recorrido o estado inválido" }, { status: 400 });
  }

  const lastStep = Number.isInteger(payload.lastStep) && Number(payload.lastStep) >= 0
    ? Math.min(Number(payload.lastStep), 100)
    : 0;

  try {
    const sql = getSql();
    const [saved] = await sql`
      INSERT INTO app_onboarding_progress (
        user_id,
        tour_key,
        tour_version,
        status,
        last_step,
        next_prompt_at,
        completed_at,
        updated_at
      ) VALUES (
        ${user.id}::uuid,
        ${payload.tourKey},
        ${ONBOARDING_VERSION},
        ${payload.status},
        ${lastStep},
        CASE WHEN ${payload.status} = 'postponed' THEN NOW() + INTERVAL '7 days' ELSE NULL END,
        CASE WHEN ${payload.status} = 'completed' THEN NOW() ELSE NULL END,
        NOW()
      )
      ON CONFLICT (user_id, tour_key)
      DO UPDATE SET
        tour_version = EXCLUDED.tour_version,
        status = EXCLUDED.status,
        last_step = EXCLUDED.last_step,
        next_prompt_at = EXCLUDED.next_prompt_at,
        completed_at = EXCLUDED.completed_at,
        updated_at = NOW()
      RETURNING tour_key, tour_version, status, last_step, next_prompt_at, completed_at, updated_at
    `;

    return NextResponse.json({
      ok: true,
      progress: {
        tourKey: String(saved.tour_key),
        tourVersion: Number(saved.tour_version),
        status: String(saved.status),
        lastStep: Number(saved.last_step),
        nextPromptAt: saved.next_prompt_at ? new Date(saved.next_prompt_at).toISOString() : null,
        completedAt: saved.completed_at ? new Date(saved.completed_at).toISOString() : null,
        updatedAt: new Date(saved.updated_at).toISOString()
      }
    });
  } catch (error) {
    console.error("Onboarding POST failed", error);
    return NextResponse.json(
      { error: "No fue posible guardar el progreso del recorrido" },
      { status: 503 }
    );
  }
}
