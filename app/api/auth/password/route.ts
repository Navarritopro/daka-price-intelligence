import { NextRequest, NextResponse } from "next/server";
import { getRequestUser, hashPassword, verifyPassword } from "@/lib/auth";
import { getSql } from "@/lib/db";

export async function POST(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sesión inválida" }, { status: 401 });
  const body = await request.json();
  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = String(body.newPassword ?? "");
  if (newPassword.length < 12) return NextResponse.json({ error: "La nueva contraseña debe tener al menos 12 caracteres" }, { status: 400 });
  const sql = getSql();
  const [stored] = await sql`SELECT password_hash FROM app_users WHERE id = ${user.id}::uuid`;
  if (!stored || !verifyPassword(currentPassword, String(stored.password_hash))) {
    return NextResponse.json({ error: "La contraseña actual no es correcta" }, { status: 401 });
  }
  await sql`UPDATE app_users SET password_hash = ${hashPassword(newPassword)}, updated_at = NOW() WHERE id = ${user.id}::uuid`;
  return NextResponse.json({ ok: true });
}
