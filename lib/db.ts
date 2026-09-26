import postgres from "postgres";

let client: ReturnType<typeof postgres> | null = null;

export function getSql() {
  // TEMP_DATABASE_URL lets the application continue on DigitalOcean while the
  // historical Neon database is unavailable. DATABASE_URL remains as a safe
  // fallback and can be restored without another code change.
  const databaseUrl = process.env.TEMP_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("TEMP_DATABASE_URL o DATABASE_URL no está configurada");
  }
  if (!client) {
    client = postgres(databaseUrl, {
      max: Number(process.env.DATABASE_POOL_SIZE ?? 5),
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false,
      ssl: process.env.DATABASE_SSL === "disable" ? false : "require"
    });
  }

  return client;
}

export function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}
