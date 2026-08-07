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
  publishedAt: 80
};

function errorResponse(code: string, message: string, status: number, requestId: string): Response {
  return Response.json(
    { error: { code, message }, requestId },
    { status, headers: { 'x-danjion-request-id': requestId, 'cache-control': 'no-store' } }
  );
}

export async function validateRequestPayload(request: Request, requestId: string): Promise<Response | null> {
  if (!['POST', 'PATCH', 'PUT'].includes(request.method)) return null;
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/v1/')) return null;

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return null;

  const text = await request.clone().text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return errorResponse('PAYLOAD_TOO_LARGE', 'Payload too large', 413, requestId);
  }
  if (!text) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return errorResponse('INVALID_JSON', 'Invalid JSON', 400, requestId);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return errorResponse('INVALID_JSON', 'JSON object required', 400, requestId);
  }

  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const max = FIELD_LIMITS[key];
    if (max !== undefined && typeof value === 'string' && value.length > max) {
      return errorResponse('VALIDATION_ERROR', `${key} must be ${max} characters or fewer`, 400, requestId);
    }
  }

  return null;
}
