import core from './index';
import { handleAdminRequest, type AdminEnv } from './admin';

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

export default {
  async fetch(request: Request, env: AdminEnv): Promise<Response> {
    const id = requestId(request);
    try {
      // Keep CORS/preflight behavior centralized in the original worker.
      if (request.method === 'OPTIONS') {
        return core.fetch(request, env);
      }
      if (new URL(request.url).pathname.startsWith('/api/v1/admin/')) {
        const response = await handleAdminRequest(request, env, id);
        if (response) return response;
      }
      return core.fetch(request, env);
    } catch (error) {
      console.error('[DanjiOn App]', id, error);
      return fail('Internal server error', id);
    }
  }
};
