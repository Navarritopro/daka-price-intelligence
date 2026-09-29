"use client";

import { FormEvent, useEffect, useState } from "react";

type User = { id: string; email: string; name: string; role: "admin" | "viewer" };

export default function AccountSettings() {
  const [user, setUser] = useState<User | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { void fetch("/api/auth/session").then((response) => response.json()).then((payload) => setUser(payload.user ?? null)); }, []);

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/auth/password", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword })
    });
    const payload = await response.json();
    setNotice(response.ok ? "Contraseña actualizada correctamente." : payload.error ?? "No fue posible actualizarla");
    if (response.ok) { setCurrentPassword(""); setNewPassword(""); }
  }

  return <main className="settings-shell"><section className="settings-card"><a href="/">← Volver al panel</a><h1>Mi cuenta</h1><p>{user?.name} · {user?.email}</p><span className="role-pill">{user?.role === "admin" ? "Administrador" : "Consulta"}</span><form onSubmit={changePassword}><label>Contraseña actual<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label><label>Nueva contraseña<input type="password" minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>{notice && <div className="settings-notice">{notice}</div>}<button className="primary-button">Cambiar contraseña</button></form></section></main>;
}
