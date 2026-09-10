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

// GAP-4: the reviewer must see the full persisted gallery, not only the
// representative mirror. The read is scoped to one application and ordered by
// sort_order, so the result is deterministic. A database failure propagates to
// the caller (fail closed) instead of silently downgrading the response to a
// representative-only view; an empty array is returned only when the read
// succeeded and the application genuinely has no gallery rows.
export async function readApplicationPhotoGallery(sql: Sql, applicationId: string): Promise<string[]> {
  const rows = await sql`
    select object_key
    from business_application_photos
    where application_id = ${applicationId}::uuid
    order by sort_order asc
  `;
  return rows.map((row) => String((row as { object_key?: string }).object_key ?? '')).filter((key) => key.length > 0);
}

// #312: reviewers open document bytes only through the admin document route,
// which is keyed by the document row id. The review context therefore exposes
// an opaque id/kind/sort-order summary per document and never the object key:
// listing gives the reviewer nothing to forge and the byte route re-checks
// authority, status, registry kind/state, and audit on every read.
export async function readApplicationDocumentSummaries(sql: Sql, applicationId: string): Promise<{ id: string; kind: string; sortOrder: number }[]> {
  const rows = await sql`
    select id, document_kind, sort_order
    from business_application_documents
    where application_id = ${applicationId}::uuid
    order by sort_order asc
  `;
  return rows.map((row) => ({
    id: String((row as { id?: string }).id),
    kind: String((row as { document_kind?: string }).document_kind ?? ''),
    sortOrder: Number((row as { sort_order?: number }).sort_order ?? 0)
  }));
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
       a.relation_raw,
       a.resolved_relation_type,
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

  const photoObjectKeys = await readApplicationPhotoGallery(sql, String(row.id));
  const documents = await readApplicationDocumentSummaries(sql, String(row.id));

  return ok({
    id: row.id,
    status: row.status,
    approvedBusinessId: row.approved_business_id,
    documents,
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
    photoObjectKeys,
    reviewBasis: {
      applicantDisplayName: row.applicant_name,
      relationType: row.relation_type,
      relationRaw: row.relation_raw,
      resolvedRelationType: row.resolved_relation_type,
      residentVerificationStatus: row.membership_verification_status,
      verificationEvidenceCount: Number(row.verification_evidence_count || 0)
    }
  }, requestId);
}
