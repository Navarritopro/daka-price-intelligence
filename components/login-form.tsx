"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function LoginForm() {
  const search = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No fue posible iniciar sesión");
      const next = search.get("next");
      window.location.assign(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand">DAKA <span>PRICE LAB</span></div>
        <p className="login-kicker">Acceso restringido</p>
        <h1>Inteligencia competitiva protegida</h1>
        <p>Ingresa con la cuenta individual autorizada por el administrador.</p>
        <form onSubmit={submit}>
          <label>Correo electrónico<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label>
          <label>Contraseña<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required minLength={12} /></label>
          {error && <div className="login-error">{error}</div>}
          <button className="primary-button" disabled={loading}>{loading ? "Verificando…" : "Iniciar sesión"}</button>
        </form>
        <small>Después de cinco intentos incorrectos, la cuenta se bloquea durante 15 minutos.</small>
      </section>
    </main>
  );
}
