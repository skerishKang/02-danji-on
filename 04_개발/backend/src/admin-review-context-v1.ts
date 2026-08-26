import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { CoreEnv } from './core-v1';
import { requireOperationalAuthority } from './operational-authz-v2';

type Sql = NeonQueryFunction<false, false>;

const BUSINESS_REVIEW_SCOPE = 'business.review';
const COUNCIL_BUSINESS_REVIEW_SCOPE = 'council.business.review';

const REQUEST_ID_HEADER = 'x-danjion-request-id';

function json(data: unknown, status: number, requestId: string): Response {
  return Response.json(data, {
    status,
    headers: {
      [REQUEST_ID_HEADER]: requestId,
      'access-control-expose-headers': REQUEST_ID_HEADER,
      'cache-control': 'no-store'
    }
  });
}

function ok(data: unknown, requestId: string): Response {
  return json({ data, requestId }, 200, requestId);
}

function fail(code: string, message: string, status: number, requestId: string): Response {
  return json({ error: { code, message }, requestId }, status, requestId);
}

export async function handleAdminReviewContextRequest(request: Request, env: CoreEnv, requestId: string): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const match = path.match(/^\/api\/v1\/admin\/business-applications\/([0-9a-fA-F-]+)\/review-context$/);
  if (!match || request.method !== 'GET') return null;
  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);

  const sql: Sql = neon(env.DATABASE_URL);
  const rows = await sql`
    select
      a.id,
      a.complex_id,
      c.slug as complex_slug,
      a.status,
      a.approved_business_id,
      a.business_name,
      a.category_name,
      a.service_summary,
      a.price_text,
      a.service_area,
      a.availability_text,
      a.benefit_text,
      a.representative_image_object_key,
      a.relation_type,
      u.display_name as applicant_name,
      coalesce(m.verification_status, 'pending') as membership_verification_status,
      coalesce((
        select count(*)::int
        from resident_verifications rv
        where rv.membership_id = m.id
      ), 0)::int as verification_evidence_count
    from business_applications a
    join complexes c on c.id = a.complex_id
    join app_users u on u.id = a.applicant_user_id
    left join complex_memberships m
      on m.user_id = a.applicant_user_id
     and m.complex_id = a.complex_id
    where a.id = ${match[1]}::uuid
    limit 1
  `;

  const row = rows[0];
  if (!row) return fail('NOT_FOUND', 'Business application not found', 404, requestId);

  const operator = await requireOperationalAuthority(
    request,
    env,
    sql,
    requestId,
    String(row.complex_slug),
    BUSINESS_REVIEW_SCOPE,
    COUNCIL_BUSINESS_REVIEW_SCOPE
  );
  if (operator instanceof Response) return operator;

  return ok({
    id: row.id,
    status: row.status,
    approvedBusinessId: row.approved_business_id,
    publicProfile: {
      businessName: row.business_name,
      categoryName: row.category_name,
      serviceSummary: row.service_summary,
      priceText: row.price_text,
      serviceArea: row.service_area,
      availabilityText: row.availability_text,
      benefitText: row.benefit_text,
      representativeImageObjectKey: row.representative_image_object_key
    },
    reviewBasis: {
      applicantDisplayName: row.applicant_name,
      relationType: row.relation_type,
      residentVerificationStatus: row.membership_verification_status,
      verificationEvidenceCount: Number(row.verification_evidence_count || 0)
    }
  }, requestId);
}
