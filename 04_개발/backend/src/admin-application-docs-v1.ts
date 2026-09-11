// Admin (reviewer) application-document lane (#372 B1 / #375 F11).
//
// Owns GET /api/v1/admin/business-applications/:applicationId/documents/:documentId.
// Reviewer authority: the application must be in a reviewable state, the actor
// must hold an operational review grant bound to the document's complex, and
// the read must be durable-audited before any bytes are served. The shared
// serving pipeline lives in application-docs-core-v1.ts; the applicant lane
// lives in resident-application-docs-v1.ts.
import { neon } from '@neondatabase/serverless';
import type { Actor } from './auth-v1';
import { requireOperationalAuthority } from './operational-authz-v2';
import {
  serveApplicationDocument,
  fail,
  UUID,
  type ApplicationDocumentEnv,
  type ApplicationDocumentLanePolicy,
  type Sql
} from './application-docs-core-v1';

const BUSINESS_REVIEW_SCOPE = 'business.review';
const COUNCIL_BUSINESS_REVIEW_SCOPE = 'council.business.review';

// REVIEWER (GET /api/v1/admin/...): rejected applications are out of review
// scope, so reviewers are denied even with a valid grant.
const REVIEWER_ALLOWED_STATUSES = ['pending', 'changes_requested', 'approved'];

const ADMIN_DOCUMENT_ROUTE =
  /^\/api\/v1\/admin\/business-applications\/([0-9a-fA-F-]+)\/documents\/([0-9a-fA-F-]+)$/;

// Reviewer access must be audit-logged with action='document.read'. Audit
// failure fails closed: the document is not served without a durable record.
async function auditReviewerDocumentRead(
  sql: Sql,
  actor: Actor,
  requestId: string,
  complexSlug: string,
  applicationId: string,
  documentId: string,
  actorRole: string
): Promise<Response | null> {
  try {
    await sql`
      insert into audit_events (
        request_id, actor_user_id, actor_kind, complex_id, action, scope, decision, reason_code, metadata
      ) values (
        ${requestId},
        ${actor.id},
        'operator',
        (select id from complexes where slug = ${complexSlug} limit 1),
        'document.read',
        ${actorRole},
        'allowed',
        'DOCUMENT_ACCESS_GRANTED',
        ${JSON.stringify({ application_id: applicationId, document_id: documentId, actor_role: actorRole })}::jsonb
      )
    `;
  } catch {
    return fail(
      'AUDIT_UNAVAILABLE',
      'Document access could not be audit-logged',
      503,
      requestId
    );
  }
  return null;
}

const adminApplicationDocumentPolicy: ApplicationDocumentLanePolicy = {
  async authorize({ request, env, sql, requestId, actor, row, applicationId, documentId }) {
    const complexSlug = String(row.complex_slug);
    const applicationStatus = String(row.application_status ?? '');

    if (!REVIEWER_ALLOWED_STATUSES.includes(applicationStatus)) {
      return fail('DOCUMENT_ACCESS_DENIED', 'Document is not available for review in current application state', 403, requestId);
    }
    // Complex binding is enforced inside requireOperationalAuthority: a grant
    // for another complex denies access here (cross-complex denial).
    const authority = await requireOperationalAuthority(
      request,
      env,
      sql,
      requestId,
      complexSlug,
      BUSINESS_REVIEW_SCOPE,
      COUNCIL_BUSINESS_REVIEW_SCOPE
    );
    if (authority instanceof Response) return authority;
    const reviewerScope = authority.authorityKind === 'padiem' ? 'business.review' : 'council.business.review';
    return {
      reviewerScope,
      auditRead: () => auditReviewerDocumentRead(
        sql, actor, requestId, complexSlug, applicationId, documentId, reviewerScope
      )
    };
  }
};

export async function handleAdminApplicationDocumentWithSql(
  request: Request,
  env: ApplicationDocumentEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const match = new URL(request.url).pathname.match(ADMIN_DOCUMENT_ROUTE);
  if (!match) return null;
  if (!UUID.test(match[1]) || !UUID.test(match[2])) {
    return fail('NOT_FOUND', 'Application document not found', 404, requestId);
  }
  return serveApplicationDocument(
    request,
    env,
    sql,
    requestId,
    adminApplicationDocumentPolicy,
    match[1].toLowerCase(),
    match[2].toLowerCase()
  );
}

export async function handleAdminApplicationDocumentRequest(
  request: Request,
  env: ApplicationDocumentEnv,
  requestId: string
): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const match = new URL(request.url).pathname.match(ADMIN_DOCUMENT_ROUTE);
  if (!match) return null;
  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);
  return handleAdminApplicationDocumentWithSql(request, env, neon(env.DATABASE_URL), requestId);
}
