export const MULTIPART_REQUEST_TOO_LARGE = 'MULTIPART_REQUEST_TOO_LARGE' as const;

type BoundedMultipartRequest =
  | { ok: true; request: Request; declaredLength: number | null }
  | { ok: false; code: typeof MULTIPART_REQUEST_TOO_LARGE; declaredLength: number | null };

function declaredContentLength(request: Request): number | null {
  const raw = request.headers.get('content-length')?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>, reason: unknown): Promise<void> {
  try {
    await reader.cancel(reason);
  } catch {
    // Client disconnects and stream cancellation races are expected here. The
    // size verdict must remain deterministic even when the underlying source
    // rejects its own cancellation.
  }
}

function concatChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * Buffer a multipart body only after enforcing a hard input-byte ceiling while
 * it is read. The final contiguous copy can transiently make peak retained
 * bytes up to 2x maxBytes; the streamed input itself is never unbounded.
 * Content-Length is an early rejection hint, never the authority: a
 * missing, malformed, or dishonest header still goes through the same stream
 * counter before any multipart parser sees the bytes.
 */
export async function withBoundedMultipartRequest(
  request: Request,
  maxBytes: number
): Promise<BoundedMultipartRequest> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError('maxBytes must be a positive safe integer');
  }

  const declaredLength = declaredContentLength(request);
  if (declaredLength !== null && declaredLength > maxBytes) {
    if (request.body) {
      try {
        await request.body.cancel('multipart request exceeds configured bound');
      } catch {
        // Preserve the deterministic 413 even if the client already disconnected.
      }
    }
    return { ok: false, code: MULTIPART_REQUEST_TOO_LARGE, declaredLength };
  }
  if (!request.body) {
    return {
      ok: true,
      request: new Request(request, { body: null }),
      declaredLength
    };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await cancelReader(reader, 'multipart request exceeds configured bound');
        return { ok: false, code: MULTIPART_REQUEST_TOO_LARGE, declaredLength };
      }
      chunks.push(value);
    }
  } catch (error) {
    await cancelReader(reader, error);
    throw error;
  } finally {
    reader.releaseLock();
  }

  const headers = new Headers(request.headers);
  headers.delete('content-length');
  const body = concatChunks(chunks, totalBytes);
  const boundedRequest = new Request(request, {
    headers,
    body: body as unknown as BodyInit
  });
  return { ok: true, request: boundedRequest, declaredLength };
}
