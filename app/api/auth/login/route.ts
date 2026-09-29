import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, hashPassword, SESSION_COOKIE, SESSION_MAX_AGE, verifyPassword } from "@/lib/auth";
import { getSql } from "@/lib/db";

const genericError = "Correo o contraseña incorrectos";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (!email || !password) return NextResponse.json({ error: genericError }, { status: 401 });

    const sql = getSql();
    const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM app_users`;
    if (Number(count) === 0) {
      const initialEmail = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
      const initialPassword = process.env.INITIAL_ADMIN_PASSWORD;
      const initialName = process.env.INITIAL_ADMIN_NAME?.trim() || "Administrador";
      if (!initialEmail || !initialPassword || initialPassword.length < 12) {
        return NextResponse.json({ error: "El administrador inicial todavía no está configurado" }, { status: 503 });
      }
      if (email === initialEmail && password === initialPassword) {
        await sql`
          INSERT INTO app_users (email, name, password_hash, role)
          VALUES (${initialEmail}, ${initialName}, ${hashPassword(initialPassword)}, 'admin')
          ON CONFLICT ((LOWER(email))) DO NOTHING
        `;
      }
    }

    const [user] = await sql`
      SELECT id::text, email, name, password_hash, role, active, locked_until
      FROM app_users
      WHERE LOWER(email) = ${email}
      LIMIT 1
    `;
    if (!user?.active || (user.locked_until && new Date(user.locked_until) > new Date())) {
      return NextResponse.json({ error: genericError }, { status: 401 });
    }
    if (!verifyPassword(password, String(user.password_hash))) {
      await sql`
        UPDATE app_users
        SET failed_login_attempts = CASE WHEN failed_login_attempts + 1 >= 5 THEN 0 ELSE failed_login_attempts + 1 END,
            locked_until = CASE WHEN failed_login_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE locked_until END,
            updated_at = NOW()
        WHERE id = ${String(user.id)}::uuid
      `;
      return NextResponse.json({ error: genericError }, { status: 401 });
    }

    await sql`
      UPDATE app_users
      SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW(), updated_at = NOW()
      WHERE id = ${String(user.id)}::uuid
    `;
    const token = createSessionToken({
      id: String(user.id), email: String(user.email), name: String(user.name), role: user.role as "admin" | "viewer"
    });
    const response = NextResponse.json({ ok: true, role: user.role });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: SESSION_MAX_AGE,
      path: "/"
    });
    return response;
  } catch (error) {
    console.error("Login failed", error);
    return NextResponse.json({ error: "No fue posible iniciar sesión" }, { status: 500 });
  }
}
