import core, { type CoreEnv } from './core-v1';
import { handleAdminAuditRequest } from './admin-audit-v1';
import { handleAdminRequest } from './admin-v1';
import { validateRequestPayload } from './payload-policy';
import { handleResidentApplicationRequest } from './resident-application-v1';

const REQUEST_ID_HEADER = 'x-danjion-request-id';
const SAFE_ID = /^[A-Za-z0-9._:-]{1,80}$/;

function requestId(request: Request): string {
  const incoming = request.headers.get(REQUEST_ID_HEADER)?.trim();
  if (incoming && SAFE_ID.test(incoming)) return incoming;
  return `req-${crypto.randomUUID()}`;
}

function fail(message: string, id: string): Response {
  return Response.json(
    { error: { code: 'INTERNAL_ERROR', message }, requestId: id },
    { status: 500, headers: { [REQUEST_ID_HEADER]: id, 'cache-control': 'no-store' } }
  );
}

function preflight(request: Request): Response {
  const origin = request.headers.get('origin')?.trim() || new URL(request.url).origin;
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': `content-type,authorization,idempotency-key,${REQUEST_ID_HEADER},x-danjion-dev-auth-user`,
      'access-control-max-age': '86400',
      'vary': 'Origin'
    }
  });
}

export default {
  async fetch(request: Request, env: CoreEnv): Promise<Response> {
    const id = requestId(request);
    try {
      if (request.method === 'OPTIONS') return preflight(request);

      const policyResponse = await validateRequestPayload(request, id);
      if (policyResponse) return policyResponse;

      const adminAuditResponse = await handleAdminAuditRequest(request, env, id);
      if (adminAuditResponse) return adminAuditResponse;

      if (new URL(request.url).pathname.startsWith('/api/v1/admin/')) {
        const response = await handleAdminRequest(request, env, id);
        if (response) return response;
      }

      const residentApplicationResponse = await handleResidentApplicationRequest(request, env, id);
      if (residentApplicationResponse) return residentApplicationResponse;

      return core.fetch(request, env);
    } catch (error) {
      console.error('[DanjiOn App]', id, error);
      return fail('Internal server error', id);
    }
  }
};
