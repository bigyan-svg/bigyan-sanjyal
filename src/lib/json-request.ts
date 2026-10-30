export class InvalidJsonRequestError extends Error {}
export class JsonRequestTooLargeError extends Error {}

export async function readJsonRequest(
  request: Request,
  maxBytes = 32 * 1024,
): Promise<unknown> {
  const contentLength = request.headers.get("content-length");

  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength)) {
      throw new InvalidJsonRequestError();
    }

    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength)) {
      throw new InvalidJsonRequestError();
    }
    if (declaredLength > maxBytes) {
      throw new JsonRequestTooLargeError();
    }
  }

  const reader = request.body?.getReader();
  if (!reader) {
    throw new InvalidJsonRequestError();
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new JsonRequestTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new InvalidJsonRequestError();
  }
}
