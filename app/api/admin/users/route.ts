import { NextRequest, NextResponse } from "next/server";
import { getRequestUser, hashPassword } from "@/lib/auth";
import { getSql } from "@/lib/db";

async function requireAdmin(request: NextRequest) {
  const user = await getRequestUser(request);
  return user?.role === "admin" ? user : null;
}

export async function GET(request: NextRequest) {
  if (!await requireAdmin(request)) return NextResponse.json({ error: "Acceso administrativo requerido" }, { status: 403 });
  const sql = getSql();
  const users = await sql`
    SELECT id::text, email, name, role, active, last_login_at, created_at
    FROM app_users ORDER BY created_at ASC
  `;
  return NextResponse.json({ users });
}

export async function POST(request: NextRequest) {
  if (!await requireAdmin(request)) return NextResponse.json({ error: "Acceso administrativo requerido" }, { status: 403 });
  const body = await request.json();
  const email = String(body.email ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim();
  const password = String(body.password ?? "");
  const role = body.role === "admin" ? "admin" : "viewer";
  if (!email.includes("@") || !name) return NextResponse.json({ error: "Nombre y correo válidos son obligatorios" }, { status: 400 });
  if (password.length < 12) return NextResponse.json({ error: "La contraseña temporal debe tener al menos 12 caracteres" }, { status: 400 });
  try {
    const sql = getSql();
    const [user] = await sql`
      INSERT INTO app_users (email, name, password_hash, role)
      VALUES (${email}, ${name}, ${hashPassword(password)}, ${role})
      RETURNING id::text, email, name, role, active, last_login_at, created_at
    `;
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    console.error("Create user failed", error);
    return NextResponse.json({ error: "El correo ya existe o no fue posible crear el usuario" }, { status: 409 });
  }
}

export async function PATCH(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "Acceso administrativo requerido" }, { status: 403 });
  const body = await request.json();
  const id = String(body.id ?? "");
  if (!id || id === admin.id) return NextResponse.json({ error: "No puedes modificar tu propio acceso desde esta pantalla" }, { status: 400 });
  const role = body.role === "admin" ? "admin" : "viewer";
  const active = body.active !== false;
  const sql = getSql();
  const [target] = await sql`SELECT role FROM app_users WHERE id = ${id}::uuid`;
  if (!target) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  if (target.role === "admin" && (role !== "admin" || !active)) {
    const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM app_users WHERE role = 'admin' AND active = TRUE`;
    if (Number(count) <= 1) return NextResponse.json({ error: "Debe permanecer al menos un administrador activo" }, { status: 409 });
  }
  const [updated] = await sql`
    UPDATE app_users SET role = ${role}, active = ${active}, updated_at = NOW()
    WHERE id = ${id}::uuid
    RETURNING id::text, email, name, role, active, last_login_at, created_at
  `;
  return NextResponse.json({ user: updated });
}
