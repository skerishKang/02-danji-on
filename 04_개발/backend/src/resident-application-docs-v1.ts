// Resident (applicant) application-document lane (#372 B1 / #375 F11).
//
// Owns GET /api/v1/me/business-applications/:applicationId/documents/:documentId.
// Applicant authority: the authenticated actor must be the application owner,
// and the application must sit in an applicant-visible state. The shared
// serving pipeline lives in application-docs-core-v1.ts; the reviewer lane
// lives in admin-application-docs-v1.ts.
import { neon } from '@neondatabase/serverless';
import {
  serveApplicationDocument,
  fail,
  UUID,
  type ApplicationDocumentEnv,
  type ApplicationDocumentLanePolicy,
  type Sql
} from './application-docs-core-v1';

// APPLICANT (GET /api/v1/me/...): owner may re-open their own evidence in every
// terminal and non-terminal state, including rejected.
const APPLICANT_ALLOWED_STATUSES = ['pending', 'changes_requested', 'approved', 'rejected'];

const ME_DOCUMENT_ROUTE =
  /^\/api\/v1\/me\/business-applications\/([0-9a-fA-F-]+)\/documents\/([0-9a-fA-F-]+)$/;

const residentApplicationDocumentPolicy: ApplicationDocumentLanePolicy = {
  async authorize({ actor, row, requestId }) {
    const applicantUserId = String(row.applicant_user_id);
    const applicationStatus = String(row.application_status ?? '');

    // Unrelated applicants get a non-disclosing 404, identical to a missing
    // document, so document existence is never oracle-able across owners.
    if (actor.id !== applicantUserId) {
      return fail('NOT_FOUND', 'Application document not found', 404, requestId);
    }
    if (!APPLICANT_ALLOWED_STATUSES.includes(applicationStatus)) {
      return fail('DOCUMENT_ACCESS_DENIED', 'Document is not accessible in current application state', 403, requestId);
    }
    // Applicant reads are intentionally unaudited for MVP.
    return { reviewerScope: null, auditRead: null };
  }
};

export async function handleResidentApplicationDocumentWithSql(
  request: Request,
  env: ApplicationDocumentEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const match = new URL(request.url).pathname.match(ME_DOCUMENT_ROUTE);
  if (!match) return null;
  if (!UUID.test(match[1]) || !UUID.test(match[2])) {
    return fail('NOT_FOUND', 'Application document not found', 404, requestId);
  }
  return serveApplicationDocument(
    request,
    env,
    sql,
    requestId,
    residentApplicationDocumentPolicy,
    match[1].toLowerCase(),
    match[2].toLowerCase()
  );
}

export async function handleResidentApplicationDocumentRequest(
  request: Request,
  env: ApplicationDocumentEnv,
  requestId: string
): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const match = new URL(request.url).pathname.match(ME_DOCUMENT_ROUTE);
  if (!match) return null;
  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);
  return handleResidentApplicationDocumentWithSql(request, env, neon(env.DATABASE_URL), requestId);
}
