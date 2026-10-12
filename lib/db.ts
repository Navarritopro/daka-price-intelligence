import postgres from "postgres";

let client: ReturnType<typeof postgres> | null = null;

export function databasePoolSize(environment: NodeJS.ProcessEnv = process.env) {
  // Cada función serverless puede crear su propia instancia. Un pool de 5 por
  // instancia agota rápidamente los límites de PostgreSQL administrado.
  if (environment.VERCEL) return 1;
  const configured = Number(environment.DATABASE_POOL_SIZE ?? 2);
  if (!Number.isFinite(configured)) return 2;
  return Math.min(Math.max(Math.trunc(configured), 1), 10);
}

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
      max: databasePoolSize(),
      idle_timeout: 5,
      max_lifetime: 60,
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
