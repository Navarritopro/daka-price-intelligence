// 5 MiB accepts both decimal 5 MB files and files reported as 5 MB by Windows.
export const MAX_UNIVERSE_FILE_BYTES = 5 * 1024 * 1024;
export const UNIVERSE_UPLOAD_PART_BYTES = 1024 * 1024;
export function validateUniverseFileSize(size: number) {
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_UNIVERSE_FILE_BYTES) {
    throw new Error("El archivo debe contener datos y pesar como máximo 5 MB (5.242.880 bytes)");
  }
}
export function validateUploadPart(offset: number, total: number, length: number) {
  validateUniverseFileSize(total);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset % UNIVERSE_UPLOAD_PART_BYTES !== 0 ||
      length !== Math.min(UNIVERSE_UPLOAD_PART_BYTES, total - offset) || length <= 0) {
    throw new Error("Parte de archivo incompleta o fuera de orden. Vuelve a validar el archivo.");
  }
}
export async function readBoundedBody(request: Request, limit: number): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > limit) throw new Error("La carga supera el tamaño permitido");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("El archivo está vacío");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("La carga supera el tamaño permitido"); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}
