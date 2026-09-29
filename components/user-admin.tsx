"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type User = { id: string; email: string; name: string; role: "admin" | "viewer"; active: boolean; last_login_at: string | null; created_at: string };

export default function UserAdmin() {
  const [users, setUsers] = useState<User[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "viewer">("viewer");
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/users", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) { setNotice(payload.error ?? "No fue posible cargar los usuarios"); return; }
    setUsers(payload.users);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function createUser(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/admin/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, email, password, role }) });
    const payload = await response.json();
    setNotice(response.ok ? "Usuario creado. Comparte la contraseña temporal por un canal seguro." : payload.error);
    if (response.ok) { setName(""); setEmail(""); setPassword(""); setRole("viewer"); void load(); }
  }

  async function updateUser(user: User, changes: Partial<Pick<User, "role" | "active">>) {
    const response = await fetch("/api/admin/users", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: user.id, role: changes.role ?? user.role, active: changes.active ?? user.active }) });
    const payload = await response.json();
    setNotice(response.ok ? "Acceso actualizado." : payload.error);
    if (response.ok) void load();
  }

  return <main className="settings-shell users-shell"><section className="settings-card users-card"><a href="/">← Volver al panel</a><h1>Usuarios autorizados</h1><p>Crea una cuenta individual por compañero y asigna el mínimo permiso necesario.</p><form className="user-create-form" onSubmit={createUser}><label>Nombre<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>Correo<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Contraseña temporal<input type="password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} required /></label><label>Rol<select value={role} onChange={(event) => setRole(event.target.value as "admin" | "viewer")}><option value="viewer">Consulta</option><option value="admin">Administrador</option></select></label><button className="primary-button">Crear usuario</button></form>{notice && <div className="settings-notice">{notice}</div>}<div className="user-list">{users.map((user) => <article key={user.id}><div><strong>{user.name}</strong><span>{user.email}</span><small>Último acceso: {user.last_login_at ? new Date(user.last_login_at).toLocaleString("es-VE", { timeZone: "America/Caracas" }) : "Nunca"}</small></div><select value={user.role} onChange={(event) => void updateUser(user, { role: event.target.value as "admin" | "viewer" })}><option value="viewer">Consulta</option><option value="admin">Administrador</option></select><button className={user.active ? "danger-button" : "secondary-button"} onClick={() => void updateUser(user, { active: !user.active })}>{user.active ? "Desactivar" : "Activar"}</button></article>)}</div></section></main>;
}
