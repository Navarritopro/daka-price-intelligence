import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sesión inválida" }, { status: 401 });
  return NextResponse.json({ user });
}
