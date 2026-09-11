import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
// #372 B1 / #375 F11: the byte surface is split into a resident lane, an
// admin lane, and a domain-neutral serving core. The Phase-B matrix is
// re-pinned across the three modules without changing any behavior contract.
const resident = await readFile(new URL('src/resident-application-docs-v1.ts', root), 'utf8');
const admin = await readFile(new URL('src/admin-application-docs-v1.ts', root), 'utf8');
const core = await readFile(new URL('src/application-docs-core-v1.ts', root), 'utf8');
const app = await readFile(new URL('src/app.ts', root), 'utf8');
const lanes = [resident, admin, core];

const applicantStatuses = resident.match(/const APPLICANT_ALLOWED_STATUSES = \[([^\]]*)\]/);
assert.ok(applicantStatuses, 'applicant status allow-list must be declared in the resident lane');
const reviewerStatuses = admin.match(/const REVIEWER_ALLOWED_STATUSES = \[([^\]]*)\]/);
assert.ok(reviewerStatuses, 'reviewer status allow-list must be declared in the admin lane');

// 1. applicant own pending allowed.
assert.ok(applicantStatuses[1].includes("'pending'"),
  '1. applicant allow-list must include pending');

// 2. applicant own rejected allowed.
assert.ok(applicantStatuses[1].includes("'rejected'"),
  '2. applicant allow-list must include rejected');

// 3. unrelated applicant denied/non-disclosing: owner mismatch answers 404
// NOT_FOUND, identical to a missing document.
assert.ok(/if \(actor\.id !== applicantUserId\) \{\s*return fail\('NOT_FOUND', 'Application document not found', 404/.test(resident),
  '3. unrelated applicant must receive non-disclosing 404 NOT_FOUND');

// 4. reviewer pending allowed.
assert.ok(reviewerStatuses[1].includes("'pending'"),
  '4. reviewer allow-list must include pending');

// 5. reviewer approved allowed.
assert.ok(reviewerStatuses[1].includes("'approved'"),
  '5. reviewer allow-list must include approved');

// 6. reviewer rejected denied: rejected is absent from the reviewer list and
// the admin lane denies before any operational-authority check.
assert.equal(reviewerStatuses[1].includes("'rejected'"), false,
  '6. reviewer allow-list must exclude rejected');
assert.ok(/if \(!REVIEWER_ALLOWED_STATUSES\.includes\(applicationStatus\)\) \{\s*return fail\('DOCUMENT_ACCESS_DENIED', [\s\S]*?, 403/.test(admin),
  '6. reviewer rejected application must be denied with 403 DOCUMENT_ACCESS_DENIED');

// 7. reviewer wrong-complex denied: authority is resolved against the
// document's own complex slug, so a grant for another complex cannot pass.
assert.ok(admin.includes('requireOperationalAuthority(') &&
  admin.includes('complexSlug,') &&
  admin.includes("'business.review'") &&
  admin.includes("'council.business.review'"),
  '7. reviewer must hold business.review/council.business.review for the document complex');

// 8. kind mismatch denied.
assert.ok(core.includes("String(row.registry_kind ?? '') !== 'application-document'") &&
  core.includes("'DOCUMENT_KIND_INVALID'"),
  '8. registry kind mismatch must be denied with DOCUMENT_KIND_INVALID');

// 9. inactive registry denied.
assert.ok(core.includes("String(row.registry_state ?? '') !== 'active'") &&
  core.includes("'DOCUMENT_NOT_ACTIVE'"),
  '9. inactive registry must be denied with DOCUMENT_NOT_ACTIVE');

// 10. audit action=document.read.
assert.ok(admin.includes("'document.read'") && admin.includes('auditReviewerDocumentRead'),
  '10. reviewer access must audit with action document.read');

// 11. reviewer audit failure fails closed: the catch maps to 503 and the
// audit gate precedes Drive streaming in the shared pipeline.
assert.ok(admin.includes("'AUDIT_UNAVAILABLE'") && admin.includes('503'),
  '11. reviewer audit failure must fail closed with 503 AUDIT_UNAVAILABLE');
assert.ok(core.indexOf('await authorization.auditRead()') < core.indexOf('return streamDriveFile('),
  '11. reviewer audit gate must precede Drive streaming');

// 11b. CORE pipeline ordering (shared serving core): lookup -> requireActor ->
// lane authorization -> registry kind/state -> registry-bound fileId parse ->
// reviewer document.read audit gate -> Drive stream.
const coreOrder = [
  'from business_application_documents bad',
  'await requireActor(request, env, sql, requestId)',
  'await policy.authorize({',
  "String(row.registry_kind ?? '') !== 'application-document'",
  "String(row.registry_state ?? '') !== 'active'",
  'parseFileId(objectKey)',
  'await authorization.auditRead()',
  'return streamDriveFile(',
];
let cursor = -1;
for (const marker of coreOrder) {
  const index = core.indexOf(marker);
  assert.ok(index > cursor, `core ordering violation: '${marker}' must appear after the previous stage`);
  cursor = index;
}

// 11c. LANE ordering: the resident lane checks ownership before applicant
// status; the admin lane denies non-reviewable status before resolving
// authority, and wires the audit gate after authority succeeds.
assert.ok(resident.indexOf('actor.id !== applicantUserId') < resident.indexOf('APPLICANT_ALLOWED_STATUSES.includes'),
  '11c. resident lane must check ownership before applicant status');
assert.ok(admin.indexOf('!REVIEWER_ALLOWED_STATUSES.includes') < admin.indexOf('const authority = await requireOperationalAuthority('),
  '11c. admin lane must deny non-reviewable status before authority');
assert.ok(admin.indexOf('const authority = await requireOperationalAuthority(') < admin.indexOf('auditRead: () => auditReviewerDocumentRead('),
  '11c. admin lane must audit only after authority is granted');

// 12. no public Drive URL / objectKey caller authority: the file id is parsed
// only from the registry-bound object key, fetched server-side with Bearer
// auth, and streamed as a body (never a shared URL).
for (const source of lanes) {
  assert.equal(source.includes("searchParams.get('objectKey')"), false,
    '12. caller-supplied objectKey authority must not exist');
  assert.equal(source.includes('drive.google.com'), false,
    '12. no public Drive URL may be constructed or returned');
}
assert.ok(core.includes('Authorization: `Bearer ${token}`') &&
  core.includes('new Response(fileResponse.body'),
  '12. Drive read must be a server-side Bearer proxy streaming the body');

// Separate routes: distinct me/admin matchers owned by their own lanes,
// separate exported handlers, and dispatch order in app.ts (admin before the
// generic admin block so it is not swallowed as NOT_FOUND).
assert.ok(resident.includes('ME_DOCUMENT_ROUTE') && admin.includes('ADMIN_DOCUMENT_ROUTE'),
  'routes must be declared as separate me/admin matchers');
assert.equal(resident.includes('ADMIN_DOCUMENT_ROUTE'), false,
  'F11. the resident lane must not own the admin matcher');
assert.equal(admin.includes('ME_DOCUMENT_ROUTE'), false,
  'F11. the admin lane must not own the me matcher');
assert.equal(core.includes('ME_DOCUMENT_ROUTE') || core.includes('ADMIN_DOCUMENT_ROUTE'), false,
  'F11. the shared core must be route-neutral');
assert.ok(resident.includes('export async function handleResidentApplicationDocumentRequest(') &&
  admin.includes('export async function handleAdminApplicationDocumentRequest('),
  'separate exported handlers must exist for me and admin routes');
assert.ok(app.includes('handleAdminApplicationDocumentRequest') &&
  app.indexOf('handleAdminApplicationDocumentRequest') < app.indexOf("startsWith('/api/v1/admin/')"),
  'admin document route must dispatch before the generic admin block');
assert.ok(app.includes('handleResidentApplicationDocumentRequest') &&
  app.indexOf('handleResidentApplicationDocumentRequest') < app.lastIndexOf('core.fetch'),
  'me document route must dispatch before core');

// 13. malformed ids fail closed without disclosure: strict UUID validation
// runs before any query so raw ids never reach ::uuid casts.
assert.ok(resident.includes('UUID.test(match[1])') && resident.includes('UUID.test(match[2])') &&
  admin.includes('UUID.test(match[1])') && admin.includes('UUID.test(match[2])'),
  '13. malformed ids must 404 without disclosure before any query');

// 14. disposition policy: PDF downloads as an attachment, images inline.
assert.ok(core.includes('attachment; filename="application-document-${documentId}.pdf"') &&
  core.includes('inline; filename="application-document-${documentId}"'),
  '14. PDF must attach and images must inline with caller-opaque filenames');

console.log('PASS GAP-5 Phase-B application document access: applicant/reviewer status matrix, non-disclosing denial, cross-complex authority, registry guards, document.read audit fail-closed, Drive proxy without caller authority (#375 F11 lane split)');
