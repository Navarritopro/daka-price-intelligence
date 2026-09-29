import LoginForm from "@/components/login-form";
import { Suspense } from "react";

export const metadata = { title: "Iniciar sesión · DAKA Price Lab" };

export default function LoginPage() {
  return <Suspense fallback={<main className="login-shell"><section className="login-card">Cargando acceso…</section></main>}><LoginForm /></Suspense>;
}
