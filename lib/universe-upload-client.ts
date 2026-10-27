import { readApiJson } from "./api-client";
import { UNIVERSE_UPLOAD_PART_BYTES, validateUniverseFileSize } from "./universe-upload-limits";

export async function prepareUniverseUpload(file: File, headers: Record<string, string>) {
  validateUniverseFileSize(file.size);
  // Keep the existing fast path for smaller workbooks.
  if (file.size <= 4_000_000) return { body: file as BodyInit, headers };
  const uploadId = crypto.randomUUID();
  try {
    for (let offset = 0; offset < file.size; offset += UNIVERSE_UPLOAD_PART_BYTES) {
      const part = file.slice(offset, offset + UNIVERSE_UPLOAD_PART_BYTES);
      const response = await fetch("/api/daka-universe/import/upload", {
        method: "POST", body: part,
        headers: { "Content-Type": "application/octet-stream", "x-upload-id": uploadId,
          "x-upload-offset": String(offset), "x-upload-total": String(file.size) }
      });
      const result = await readApiJson<{ received?: number; error?: string }>(response, "No fue posible subir el archivo. Vuelve a intentarlo.");
      if (!response.ok || result.received !== offset + part.size) throw new Error(result.error ?? "La carga quedó incompleta. Vuelve a intentarlo.");
    }
  } catch (error) {
    await fetch("/api/daka-universe/import/upload", { method: "DELETE", headers: { "x-upload-id": uploadId } }).catch(() => undefined);
    throw error;
  }
  return { body: null, headers: { ...headers, "x-upload-id": uploadId } };
}
