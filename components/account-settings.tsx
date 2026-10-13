"use client";

import { FormEvent, useEffect, useState } from "react";
import { readApiJson } from "@/lib/api-client";

type User = { id: string; email: string; name: string; role: "admin" | "viewer" };

export default function AccountSettings() {
  const [user, setUser] = useState<User | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    void fetch("/api/auth/session")
      .then((response) => readApiJson<{ user?: User | null }>(response, "No fue posible consultar la sesión"))
      .then((payload) => setUser(payload.user ?? null))
      .catch(() => setUser(null));
  }, []);

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword })
      });
      await readApiJson<{ error?: string }>(response, "No fue posible actualizarla");
      setNotice("Contraseña actualizada correctamente.");
      setCurrentPassword(""); setNewPassword("");
    } catch (requestError) {
      setNotice(requestError instanceof Error ? requestError.message : "No fue posible actualizarla");
    }
  }

  return <main className="settings-shell"><section className="settings-card"><a href="/">← Volver al panel</a><h1>Mi cuenta</h1><p>{user?.name} · {user?.email}</p><span className="role-pill">{user?.role === "admin" ? "Administrador" : "Consulta"}</span><form onSubmit={changePassword}><label>Contraseña actual<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label><label>Nueva contraseña<input type="password" minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>{notice && <div className="settings-notice">{notice}</div>}<button className="primary-button">Cambiar contraseña</button></form></section></main>;
}
