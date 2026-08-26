import core, { type CoreEnv } from './core-v1';
import { handleAdminAuditRequest } from './admin-audit-v1';
import { handleAdminReviewContextRequest } from './admin-review-context-v1';
import { handleAdminVerificationRequest } from './admin-verification-v1';
import { handleAdminRequest } from './admin-v1';
import { handleBenefitWalletRequest } from './benefit-wallet-v1';
import { handleCommunityModerationRequest } from './community-moderation-v1';
import { handleCommunityResidentRequest } from './community-resident-v1';
import { validateRequestPayload } from './payload-policy';
import { handleResidentApplicationRequest } from './resident-application-v1';
import { handleResidentVerificationRequest } from './resident-verification-v1';
import { handleStorageRequest } from './storage-v1';

const REQUEST_ID_HEADER = 'x-danjion-request-id';
const SAFE_ID = /^[A-Za-z0-9._:-]{1,80}$/;

type AppEnv = CoreEnv & {
  CORS_ALLOWED_ORIGINS?: string;
  COMMUNITY_PUBLISH_MODE?: string;
};

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

function originMatchesRule(origin: string, rule: string): boolean {
  if (origin === rule) return true;

  const marker = '://*.';
  const markerIndex = rule.indexOf(marker);
  if (markerIndex < 1) return false;

  const protocol = rule.slice(0, markerIndex);
  const hostnameSuffix = rule.slice(markerIndex + marker.length);
  if (!hostnameSuffix || hostnameSuffix.includes('/') || hostnameSuffix.includes(':')) return false;

  try {
    const candidate = new URL(origin);
    return candidate.protocol === `${protocol}:`
      && !candidate.port
      && candidate.hostname.endsWith(`.${hostnameSuffix}`);
  } catch {
    return false;
  }
}

function allowedOrigin(request: Request, env: AppEnv): string | null {
  const origin = request.headers.get('origin')?.trim();
  if (!origin) return null;

  const rules = (env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return rules.some((rule) => originMatchesRule(origin, rule)) ? origin : null;
}

function appendVaryOrigin(headers: Headers): void {
  const vary = headers.get('vary');
  if (!vary) {
    headers.set('vary', 'Origin');
    return;
  }

  const values = vary.split(',').map((value) => value.trim().toLowerCase());
  if (!values.includes('origin')) headers.set('vary', `${vary}, Origin`);
}

function withCors(response: Response, request: Request, env: AppEnv): Response {
  const origin = allowedOrigin(request, env);
  if (!origin) return response;

  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', origin);
  headers.set('access-control-expose-headers', REQUEST_ID_HEADER);
  appendVaryOrigin(headers);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function preflight(request: Request, env: AppEnv): Response {
  const incomingOrigin = request.headers.get('origin')?.trim();
  const origin = allowedOrigin(request, env);
  if (incomingOrigin && !origin) {
    return new Response(null, {
      status: 403,
      headers: { 'cache-control': 'no-store', 'vary': 'Origin' }
    });
  }

  const headers = new Headers({
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': `content-type,authorization,idempotency-key,${REQUEST_ID_HEADER},x-danjion-dev-auth-user`,
    'access-control-max-age': '86400',
    'cache-control': 'no-store'
  });
  if (origin) headers.set('access-control-allow-origin', origin);
  appendVaryOrigin(headers);

  return new Response(null, { status: 204, headers });
}

export default {
  async fetch(request: Request, env: AppEnv): Promise<Response> {
    const id = requestId(request);
    const respond = (response: Response) => withCors(response, request, env);

    try {
      if (request.method === 'OPTIONS') return preflight(request, env);

      const policyResponse = await validateRequestPayload(request, id);
      if (policyResponse) return respond(policyResponse);

      const storageResponse = await handleStorageRequest(request, env, id);
      if (storageResponse) return respond(storageResponse);

      const adminAuditResponse = await handleAdminAuditRequest(request, env, id);
      if (adminAuditResponse) return respond(adminAuditResponse);

      const adminReviewContextResponse = await handleAdminReviewContextRequest(request, env, id);
      if (adminReviewContextResponse) return respond(adminReviewContextResponse);

      const adminVerificationResponse = await handleAdminVerificationRequest(request, env, id);
      if (adminVerificationResponse) return respond(adminVerificationResponse);

      if (new URL(request.url).pathname.startsWith('/api/v1/admin/')) {
        const response = await handleAdminRequest(request, env, id);
        if (response) return respond(response);
      }

      const communityModerationResponse = await handleCommunityModerationRequest(request, env, id);
      if (communityModerationResponse) return respond(communityModerationResponse);

      const communityResidentResponse = await handleCommunityResidentRequest(request, env, id);
      if (communityResidentResponse) return respond(communityResidentResponse);

      const residentVerificationResponse = await handleResidentVerificationRequest(request, env, id);
      if (residentVerificationResponse) return respond(residentVerificationResponse);

      const benefitWalletResponse = await handleBenefitWalletRequest(request, env, id);
      if (benefitWalletResponse) return respond(benefitWalletResponse);

      const residentApplicationResponse = await handleResidentApplicationRequest(request, env, id);
      if (residentApplicationResponse) return respond(residentApplicationResponse);

      return respond(await core.fetch(request, env));
    } catch (error) {
      console.error('[DanjiOn App]', id, error);
      return respond(fail('Internal server error', id));
    }
  }
};
