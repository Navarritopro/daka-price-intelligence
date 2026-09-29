import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { getSql } from "@/lib/db";

export const SESSION_COOKIE = "daka_price_session";
export const SESSION_MAX_AGE = 60 * 60 * 8;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "viewer";
  exp: number;
};

function authSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET debe tener al menos 32 caracteres");
  return secret;
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string) {
  const [salt, expectedHex] = stored.split(":");
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createSessionToken(user: Omit<SessionUser, "exp">) {
  const payload: SessionUser = { ...user, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", authSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifySessionToken(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  try {
    const expected = createHmac("sha256", authSecret()).update(encoded).digest();
    const supplied = Buffer.from(signature, "base64url");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionUser;
    if (!payload.id || !payload.email || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    if (payload.role !== "admin" && payload.role !== "viewer") return null;
    return payload;
  } catch {
    return null;
  }
}

export async function getRequestUser(request: NextRequest) {
  const session = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const sql = getSql();
  const [user] = await sql`
    SELECT id::text, email, name, role, active
    FROM app_users
    WHERE id = ${session.id}::uuid
    LIMIT 1
  `;
  if (!user?.active) return null;
  return {
    id: String(user.id),
    email: String(user.email),
    name: String(user.name),
    role: user.role as "admin" | "viewer"
  };
}

export async function isAdminRequest(request: NextRequest) {
  const user = await getRequestUser(request);
  if (user?.role === "admin") return true;
  const configuredKey = process.env.ADMIN_API_KEY;
  return Boolean(configuredKey && request.headers.get("x-admin-key") === configuredKey);
}
