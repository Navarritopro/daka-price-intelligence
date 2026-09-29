import UserAdmin from "@/components/user-admin";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

export const metadata = { title: "Usuarios · DAKA Price Lab" };

export default async function UsersPage() {
  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (session?.role !== "admin") redirect("/");
  return <UserAdmin />;
}
