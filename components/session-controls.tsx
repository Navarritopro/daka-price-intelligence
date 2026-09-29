"use client";

import { useEffect, useState } from "react";

type User = { email: string; name: string; role: "admin" | "viewer" };

export default function SessionControls({ onRole }: { onRole?: (role: "admin" | "viewer") => void }) {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    void fetch("/api/auth/session", { cache: "no-store" }).then((response) => response.json()).then((payload) => {
      setUser(payload.user ?? null);
      if (payload.user?.role) onRole?.(payload.user.role);
    });
  }, [onRole]);
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); window.location.assign("/login"); }
  return <div className="session-controls"><div><strong>{user?.name ?? "Usuario"}</strong><span>{user?.role === "admin" ? "Administrador" : "Consulta"}</span></div>{user?.role === "admin" && <a href="/admin/users">Usuarios</a>}<a href="/account">Mi cuenta</a><button onClick={() => void logout()}>Salir</button></div>;
}
