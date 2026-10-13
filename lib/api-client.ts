export type ApiErrorPayload = {
  error?: unknown;
  message?: unknown;
  code?: unknown;
};

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly retryable: boolean;

  constructor(message: string, status = 0, code: string | null = null, retryable = false) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 502, 503, 504]);

function statusMessage(status: number) {
  if (status === 401) return "Tu sesión venció. Inicia sesión nuevamente.";
  if (status === 403) return "No tienes permisos para realizar esta acción.";
  if (status === 404) return "La información solicitada no está disponible.";
  if (status === 408 || status === 504) return "La consulta tardó demasiado. Intenta nuevamente.";
  if (status === 429) return "Hay demasiadas solicitudes. Espera un momento e intenta nuevamente.";
  if (status >= 500) return "El servicio no está disponible temporalmente. Intenta nuevamente.";
  return "No fue posible completar la solicitud.";
}

function payloadMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as ApiErrorPayload;
  if (typeof candidate.error === "string" && candidate.error.trim()) return candidate.error.trim();
  if (typeof candidate.message === "string" && candidate.message.trim()) return candidate.message.trim();
  return null;
}

function payloadCode(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const code = (payload as ApiErrorPayload).code;
  return typeof code === "string" && code.trim() ? code.trim() : null;
}

/**
 * Reads an API response without assuming that the body contains valid JSON.
 * This prevents empty responses, HTML error pages and truncated payloads from
 * surfacing as the unhelpful "Unexpected end of JSON input" browser error.
 */
export async function readApiJson<T>(response: Response, fallbackMessage?: string): Promise<T> {
  let raw = "";
  try {
    raw = await response.text();
  } catch {
    throw new ApiRequestError(
      fallbackMessage ?? statusMessage(response.status),
      response.status,
      null,
      RETRYABLE_STATUS.has(response.status)
    );
  }

  if (!raw.trim()) {
    const message = response.ok
      ? "El servidor devolvió una respuesta vacía. Intenta nuevamente."
      : fallbackMessage ?? statusMessage(response.status);
    throw new ApiRequestError(message, response.status, null, RETRYABLE_STATUS.has(response.status));
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    const message = response.ok
      ? "El servidor devolvió una respuesta inválida. Intenta nuevamente."
      : fallbackMessage ?? statusMessage(response.status);
    throw new ApiRequestError(message, response.status, null, RETRYABLE_STATUS.has(response.status));
  }

  if (!response.ok) {
    throw new ApiRequestError(
      payloadMessage(payload) ?? fallbackMessage ?? statusMessage(response.status),
      response.status,
      payloadCode(payload),
      RETRYABLE_STATUS.has(response.status)
    );
  }

  return payload as T;
}

export function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

type ApiRequestOptions = {
  fallbackMessage?: string;
  retries?: number;
  retryDelayMs?: number;
  fetcher?: typeof fetch;
};

function wait(milliseconds: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The operation was aborted", "AbortError"));
      return;
    }
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new DOMException("The operation was aborted", "AbortError"));
    }, { once: true });
  });
}

/**
 * Shared JSON request helper. Retries are disabled by default and are only
 * allowed for idempotent GET/HEAD requests and transient failures.
 */
export async function apiRequest<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: ApiRequestOptions = {}
): Promise<T> {
  const fetcher = options.fetcher ?? fetch;
  const method = (init.method ?? "GET").toUpperCase();
  const requestedRetries = Math.max(0, Math.trunc(options.retries ?? 0));
  const retries = method === "GET" || method === "HEAD" ? Math.min(requestedRetries, 2) : 0;
  const retryDelayMs = Math.max(0, Math.trunc(options.retryDelayMs ?? 250));

  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetcher(input, init);
      return await readApiJson<T>(response, options.fallbackMessage);
    } catch (error) {
      if (isAbortError(error)) throw error;
      const retryable = error instanceof ApiRequestError ? error.retryable : true;
      if (!retryable || attempt >= retries) {
        if (error instanceof Error) throw error;
        throw new ApiRequestError(options.fallbackMessage ?? "No fue posible completar la solicitud.");
      }
      await wait(retryDelayMs * (attempt + 1), init.signal);
    }
  }
}
