import core, { type CoreEnv } from './core-v1';
import { handleAccountLifecycleRequest } from './account-lifecycle-v1';
import { handleAdminAuditRequest } from './admin-audit-v1';
import { handleAdminOperationalRequest } from './admin-operational-v2';
import { handleAdminReviewContextRequest } from './admin-review-context-v1';
import { handleAdminVerificationRequest } from './admin-verification-v1';
import { handleAdminRequest } from './admin-v1';
import { handleBetterAuthRequest, type BetterAuthEnv } from './auth-better-v1';
import { handleBenefitWalletRequest } from './benefit-wallet-v1';
import { handleBusinessReviewRequest } from './business-reviews-v1';
import { handleBusinessShareRequest } from './business-share-v1';
import { handleCommunityModerationRequest } from './community-moderation-v1';
import { handleCommunityReplyRequest } from './community-replies-v1';
import { handleCommunityResidentRequest } from './community-resident-v1';
import { handleHouseholdPrimaryClaimRequest } from './household-claim-v2';
import { handleHouseholdFamilyRequest } from './household-family-v2';
import { handleHouseholdUnitMasterRequest } from './household-master-v2';
import { handleInquiryRequest } from './inquiries-v1';
import { validateRequestPayload } from './payload-policy';
import { handleProductMutationRateLimitRequest } from './product-rate-limit-v1';
import { handleResidentActivityRequest } from './resident-activity-v1';
import { handleResidentApplicationRequest } from './resident-application-v1';
import { handleResidentBlockRequest } from './resident-blocks-v1';
import { handleResidentEconomyMutationRequest } from './resident-economy-v2';
import { handleResidentMessageRequest } from './resident-messages-v1';
import { handleResidentNewsRequest } from './resident-news-v1';
import { handleResidentNotificationRequest } from './resident-notifications-v1';
import { handleResidentProfileRequest } from './resident-profile-v1';
import { handleResidentSafetyReportRequest } from './resident-safety-reports-v1';
import { handleResidentSettingsRequest } from './resident-settings-v1';
import { handleResidentSummaryRequest } from './resident-summary-v1';
import { handleResidentVerificationRequest } from './resident-verification-v1';
import { handleShopRecommendationRequest } from './shop-recommendations-v1';
import {
  handleSignupContactVerificationRequest,
  type SignupContactVerificationEnv
} from './signup-contact-verification-v1';
import { handleTrackedStorageUploadRequest } from './storage-upload-v2';
import { handleStorageRequest } from './storage-v1';
import { handleVerifiedSignupRequest } from './verified-signup-v1';

const REQUEST_ID_HEADER = 'x-danjion-request-id';
const SAFE_ID = /^[A-Za-z0-9._:-]{1,80}$/;

type AppEnv = CoreEnv & BetterAuthEnv & SignupContactVerificationEnv & {
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
  const rules = (env.CORS_ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean);
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
  headers.set('access-control-expose-headers', `${REQUEST_ID_HEADER}, Retry-After, X-Retry-After`);
  appendVaryOrigin(headers);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function preflight(request: Request, env: AppEnv): Response {
  const incomingOrigin = request.headers.get('origin')?.trim();
  const origin = allowedOrigin(request, env);
  if (incomingOrigin && !origin) {
    return new Response(null, { status: 403, headers: { 'cache-control': 'no-store', 'vary': 'Origin' } });
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
      const authResponse = await handleBetterAuthRequest(request, env);
      if (authResponse) return respond(authResponse);
      const verifiedSignupResponse = await handleVerifiedSignupRequest(request, env, id);
      if (verifiedSignupResponse) return respond(verifiedSignupResponse);
      const signupVerificationResponse = await handleSignupContactVerificationRequest(request, env, id);
      if (signupVerificationResponse) return respond(signupVerificationResponse);
      const policyResponse = await validateRequestPayload(request, id);
      if (policyResponse) return respond(policyResponse);
      const businessShareResponse = await handleBusinessShareRequest(request, env, id);
      if (businessShareResponse) return respond(businessShareResponse);
      const accountLifecycleResponse = await handleAccountLifecycleRequest(request, env, id);
      if (accountLifecycleResponse) return respond(accountLifecycleResponse);
      const productMutationRateLimitResponse = await handleProductMutationRateLimitRequest(request, env, id);
      if (productMutationRateLimitResponse) return respond(productMutationRateLimitResponse);
      const trackedStorageUploadResponse = await handleTrackedStorageUploadRequest(request, env, id);
      if (trackedStorageUploadResponse) return respond(trackedStorageUploadResponse);
      const storageResponse = await handleStorageRequest(request, env, id);
      if (storageResponse) return respond(storageResponse);
      const adminAuditResponse = await handleAdminAuditRequest(request, env, id);
      if (adminAuditResponse) return respond(adminAuditResponse);
      const adminReviewContextResponse = await handleAdminReviewContextRequest(request, env, id);
      if (adminReviewContextResponse) return respond(adminReviewContextResponse);
      const adminVerificationResponse = await handleAdminVerificationRequest(request, env, id);
      if (adminVerificationResponse) return respond(adminVerificationResponse);
      const adminOperationalResponse = await handleAdminOperationalRequest(request, env, id);
      if (adminOperationalResponse) return respond(adminOperationalResponse);
      const communityModerationResponse = await handleCommunityModerationRequest(request, env, id);
      if (communityModerationResponse) return respond(communityModerationResponse);
      const residentNewsResponse = await handleResidentNewsRequest(request, env, id);
      if (residentNewsResponse) return respond(residentNewsResponse);
      const residentSafetyReportResponse = await handleResidentSafetyReportRequest(request, env, id);
      if (residentSafetyReportResponse) return respond(residentSafetyReportResponse);
      const shopRecommendationResponse = await handleShopRecommendationRequest(request, env, id);
      if (shopRecommendationResponse) return respond(shopRecommendationResponse);
      const inquiryResponse = await handleInquiryRequest(request, env, id);
      if (inquiryResponse) return respond(inquiryResponse);
      if (new URL(request.url).pathname.startsWith('/api/v1/admin/')) {
        const response = await handleAdminRequest(request, env, id);
        if (response) return respond(response);
      }
      const householdMasterResponse = await handleHouseholdUnitMasterRequest(request, env, id);
      if (householdMasterResponse) return respond(householdMasterResponse);
      const householdClaimResponse = await handleHouseholdPrimaryClaimRequest(request, env, id);
      if (householdClaimResponse) return respond(householdClaimResponse);
      const householdFamilyResponse = await handleHouseholdFamilyRequest(request, env, id);
      if (householdFamilyResponse) return respond(householdFamilyResponse);
      const residentBlockResponse = await handleResidentBlockRequest(request, env, id);
      if (residentBlockResponse) return respond(residentBlockResponse);
      const businessReviewResponse = await handleBusinessReviewRequest(request, env, id);
      if (businessReviewResponse) return respond(businessReviewResponse);
      const residentSummaryResponse = await handleResidentSummaryRequest(request, env, id);
      if (residentSummaryResponse) return respond(residentSummaryResponse);
      const residentActivityResponse = await handleResidentActivityRequest(request, env, id);
      if (residentActivityResponse) return respond(residentActivityResponse);
      const residentSettingsResponse = await handleResidentSettingsRequest(request, env, id);
      if (residentSettingsResponse) return respond(residentSettingsResponse);
      const residentProfileResponse = await handleResidentProfileRequest(request, env, id);
      if (residentProfileResponse) return respond(residentProfileResponse);
      const residentNotificationResponse = await handleResidentNotificationRequest(request, env, id);
      if (residentNotificationResponse) return respond(residentNotificationResponse);
      const residentMessageResponse = await handleResidentMessageRequest(request, env, id);
      if (residentMessageResponse) return respond(residentMessageResponse);
      const communityReplyResponse = await handleCommunityReplyRequest(request, env, id);
      if (communityReplyResponse) return respond(communityReplyResponse);
      const communityResidentResponse = await handleCommunityResidentRequest(request, env, id);
      if (communityResidentResponse) return respond(communityResidentResponse);
      const residentVerificationResponse = await handleResidentVerificationRequest(request, env, id);
      if (residentVerificationResponse) return respond(residentVerificationResponse);
      const residentEconomyResponse = await handleResidentEconomyMutationRequest(request, env, id);
      if (residentEconomyResponse) return respond(residentEconomyResponse);
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
