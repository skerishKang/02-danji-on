const MAX_BODY_BYTES = 128 * 1024;

const FIELD_LIMITS: Record<string, number> = {
  businessName: 80,
  categoryName: 80,
  serviceSummary: 500,
  priceText: 200,
  contactMethod: 80,
  serviceArea: 200,
  benefitText: 300,
  availabilityText: 200,
  representativeImageObjectKey: 1000,
  reviewNote: 1000,
  sourceName: 80,
  category: 80,
  title: 160,
  body: 10000,
  description: 2000,
  conditions: 1000,
  attachmentObjectKey: 1000,
  businessId: 80,
  status: 32,
  startsAt: 80,
  endsAt: 80,
  publishedAt: 80,
  consentType: 80,
  policyVersion: 80,
  confirm: 80,
  reason: 500
};

export { MAX_BODY_BYTES };

function errorResponse(code: string, message: string, status: number, requestId: string): Response {
  return Response.json(
    { error: { code, message }, requestId },
    { status, headers: { 'x-danjion-request-id': requestId, 'cache-control': 'no-store' } }
  );
}

function isJsonContentType(contentType: string): boolean {
  return contentType.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

async function readBoundedBody(
  request: Request,
  requestId: string,
  maxBytes: number
): Promise<Uint8Array | Response> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxBytes) {
    return errorResponse('PAYLOAD_TOO_LARGE', 'Payload too large', 413, requestId);
  }

  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) {
        await reader.cancel();
        return errorResponse('INVALID_JSON', 'Invalid JSON', 400, requestId);
      }
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return errorResponse('PAYLOAD_TOO_LARGE', 'Payload too large', 413, requestId);
      }
      chunks.push(next.value);
    }
  } catch {
    return errorResponse('INVALID_JSON', 'Invalid JSON', 400, requestId);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readBoundedJsonBody(
  request: Request,
  requestId: string,
  maxBytes = MAX_BODY_BYTES
): Promise<Record<string, unknown> | Response> {
  if (!isJsonContentType(request.headers.get('content-type') || '')) {
    return errorResponse('CONTENT_TYPE_REQUIRED', 'application/json required', 415, requestId);
  }
  const raw = await readBoundedBody(request, requestId, maxBytes);
  if (raw instanceof Response) return raw;
  if (raw.byteLength === 0) return errorResponse('INVALID_JSON', 'Invalid JSON', 400, requestId);
  try {
    const payload = JSON.parse(new TextDecoder().decode(raw));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return errorResponse('INVALID_JSON', 'JSON object required', 400, requestId);
    }
    return payload as Record<string, unknown>;
  } catch {
    return errorResponse('INVALID_JSON', 'Invalid JSON', 400, requestId);
  }
}

function validateFieldLimits(payload: Record<string, unknown>): { code: string; message: string } | null {
  for (const [key, value] of Object.entries(payload)) {
    const max = FIELD_LIMITS[key];
    if (max !== undefined && typeof value === 'string' && value.length > max) {
      return { code: 'VALIDATION_ERROR', message: `${key} must be ${max} characters or fewer` };
    }
  }
  return null;
}

export async function validateRequestPayload(request: Request, requestId: string): Promise<Response | null> {
  if (!['POST', 'PATCH', 'PUT'].includes(request.method)) return null;
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/v1/')) return null;
  if (url.pathname === '/api/v1/storage/objects' && request.method === 'POST') return null;

  const contentType = request.headers.get('content-type') || '';
  if (!isJsonContentType(contentType)) {
    return errorResponse('CONTENT_TYPE_REQUIRED', 'application/json required', 415, requestId);
  }

  const raw = await readBoundedBody(request.clone() as Request, requestId, MAX_BODY_BYTES);
  if (raw instanceof Response) return raw;
  if (raw.byteLength === 0) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return errorResponse('INVALID_JSON', 'Invalid JSON', 400, requestId);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return errorResponse('INVALID_JSON', 'JSON object required', 400, requestId);
  }
  const fieldError = validateFieldLimits(payload as Record<string, unknown>);
  if (fieldError) return errorResponse(fieldError.code, fieldError.message, 400, requestId);
  return null;
}
