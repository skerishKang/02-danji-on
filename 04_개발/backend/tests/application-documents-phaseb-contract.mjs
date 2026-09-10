import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const docs = await readFile(new URL('src/resident-application-docs-v1.ts', root), 'utf8');
const app = await readFile(new URL('src/app.ts', root), 'utf8');

const applicantStatuses = docs.match(/const APPLICANT_ALLOWED_STATUSES = \[([^\]]*)\]/);
assert.ok(applicantStatuses, 'applicant status allow-list must be declared');
const reviewerStatuses = docs.match(/const REVIEWER_ALLOWED_STATUSES = \[([^\]]*)\]/);
assert.ok(reviewerStatuses, 'reviewer status allow-list must be declared');

// 1. applicant own pending allowed.
assert.ok(applicantStatuses[1].includes("'pending'"),
  '1. applicant allow-list must include pending');

// 2. applicant own rejected allowed.
assert.ok(applicantStatuses[1].includes("'rejected'"),
  '2. applicant allow-list must include rejected');

// 3. unrelated applicant denied/non-disclosing: owner mismatch answers 404
// NOT_FOUND, identical to a missing document.
assert.ok(/if \(actor\.id !== applicantUserId\) \{\s*return fail\('NOT_FOUND', 'Application document not found', 404/.test(docs),
  '3. unrelated applicant must receive non-disclosing 404 NOT_FOUND');

// 4. reviewer pending allowed.
assert.ok(reviewerStatuses[1].includes("'pending'"),
  '4. reviewer allow-list must include pending');

// 5. reviewer approved allowed.
assert.ok(reviewerStatuses[1].includes("'approved'"),
  '5. reviewer allow-list must include approved');

// 6. reviewer rejected denied: rejected is absent from the reviewer list and
// the admin branch denies before any operational-authority check.
assert.equal(reviewerStatuses[1].includes("'rejected'"), false,
  '6. reviewer allow-list must exclude rejected');
assert.ok(/if \(!REVIEWER_ALLOWED_STATUSES\.includes\(applicationStatus\)\) \{\s*return fail\('DOCUMENT_ACCESS_DENIED', [\s\S]*?, 403/.test(docs),
  '6. reviewer rejected application must be denied with 403 DOCUMENT_ACCESS_DENIED');

// 7. reviewer wrong-complex denied: authority is resolved against the
// document's own complex slug, so a grant for another complex cannot pass.
assert.ok(docs.includes('requireOperationalAuthority(') &&
  docs.includes('complexSlug,') &&
  docs.includes("'business.review'") &&
  docs.includes("'council.business.review'"),
  '7. reviewer must hold business.review/council.business.review for the document complex');

// 8. kind mismatch denied.
assert.ok(docs.includes("String(row.registry_kind ?? '') !== 'application-document'") &&
  docs.includes("'DOCUMENT_KIND_INVALID'"),
  '8. registry kind mismatch must be denied with DOCUMENT_KIND_INVALID');

// 9. inactive registry denied.
assert.ok(docs.includes("String(row.registry_state ?? '') !== 'active'") &&
  docs.includes("'DOCUMENT_NOT_ACTIVE'"),
  '9. inactive registry must be denied with DOCUMENT_NOT_ACTIVE');

// 10. audit action=document.read.
assert.ok(docs.includes("'document.read'") && docs.includes('auditReviewerDocumentRead'),
  '10. reviewer access must audit with action document.read');

// 11. reviewer audit failure fails closed: the catch maps to 503 and the
// audit gate precedes Drive streaming in the admin branch.
assert.ok(docs.includes("'AUDIT_UNAVAILABLE'") && docs.includes('503'),
  '11. reviewer audit failure must fail closed with 503 AUDIT_UNAVAILABLE');
assert.ok(docs.indexOf('auditReviewerDocumentRead(') < docs.indexOf('return streamDriveFile('),
  '11. reviewer audit gate must precede Drive streaming');

// 11b. CENTRAL ordering: lookup -> requireActor -> ownership/status or
// reviewer authority/status -> registry kind/state -> registry-bound fileId
// parse -> reviewer document.read audit -> Drive stream.
const order = [
  'from business_application_documents bad',
  'await requireActor(request, env, sql, requestId)',
  'actor.id !== applicantUserId',
  'const authority = await requireOperationalAuthority(',
  "String(row.registry_kind ?? '') !== 'application-document'",
  "String(row.registry_state ?? '') !== 'active'",
  'parseFileId(objectKey)',
  'await auditReviewerDocumentRead(',
  'return streamDriveFile(',
];
let cursor = -1;
for (const marker of order) {
  const index = docs.indexOf(marker);
  assert.ok(index > cursor, `ordering violation: '${marker}' must appear after the previous stage`);
  cursor = index;
}

// 12. no public Drive URL / objectKey caller authority: the file id is parsed
// only from the registry-bound object key, fetched server-side with Bearer
// auth, and streamed as a body (never a shared URL).
assert.equal(docs.includes("searchParams.get('objectKey')"), false,
  '12. caller-supplied objectKey authority must not exist');
assert.equal(docs.includes('drive.google.com'), false,
  '12. no public Drive URL may be constructed or returned');
assert.ok(docs.includes('Authorization: `Bearer ${token}`') &&
  docs.includes('new Response(fileResponse.body'),
  '12. Drive read must be a server-side Bearer proxy streaming the body');

// Separate routes: distinct me/admin matchers, handlers, and dispatch order
// (admin before the generic admin block so it is not swallowed as NOT_FOUND).
assert.ok(docs.includes('ME_DOCUMENT_ROUTE') && docs.includes('ADMIN_DOCUMENT_ROUTE'),
  'routes must be declared as separate me/admin matchers');
assert.ok(docs.includes('export async function handleResidentApplicationDocumentRequest(') &&
  docs.includes('export async function handleAdminApplicationDocumentRequest('),
  'separate exported handlers must exist for me and admin routes');
assert.ok(app.includes('handleAdminApplicationDocumentRequest') &&
  app.indexOf('handleAdminApplicationDocumentRequest') < app.indexOf("startsWith('/api/v1/admin/')"),
  'admin document route must dispatch before the generic admin block');
assert.ok(app.includes('handleResidentApplicationDocumentRequest') &&
  app.indexOf('handleResidentApplicationDocumentRequest') < app.lastIndexOf('core.fetch'),
  'me document route must dispatch before core');

// 13. malformed ids fail closed without disclosure: strict UUID validation
// runs before any query so raw ids never reach ::uuid casts.
assert.ok(docs.includes('UUID.test(match[1])') && docs.includes('UUID.test(match[2])'),
  '13. malformed ids must 404 without disclosure before any query');

// 14. disposition policy: PDF downloads as an attachment, images inline.
assert.ok(docs.includes('attachment; filename="application-document-${documentId}.pdf"') &&
  docs.includes('inline; filename="application-document-${documentId}"'),
  '14. PDF must attach and images must inline with caller-opaque filenames');

console.log('PASS GAP-5 Phase-B application document access: applicant/reviewer status matrix, non-disclosing denial, cross-complex authority, registry guards, document.read audit fail-closed, Drive proxy without caller authority');
