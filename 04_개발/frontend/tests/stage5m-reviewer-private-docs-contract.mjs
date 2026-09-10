import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [api, page] = await Promise.all([
  readFile(new URL('src/operations-review-api.ts', root), 'utf8'),
  readFile(new URL('src/OperationsReviewPage.tsx', root), 'utf8')
]);

// 1. Bytes come only from the canonical admin document route, keyed by the
// opaque application/document ids.
assert.match(
  api,
  /`\$\{API_BASE\}\/api\/v1\/admin\/business-applications\/\$\{encodeURIComponent\(applicationId\)\}\/documents\/\$\{encodeURIComponent\(documentId\)\}`/,
  '1. document bytes must use the canonical admin byte route'
);
assert.match(api, /authenticatedFetch\(adminDocumentRoute\(applicationId, documentId\), \{ method: 'GET' \}, 'admin'\)/,
  '2. byte fetch must ride the authenticated admin surface (no manual token handling)');

// 3. No Drive or objectKey caller authority anywhere in the leaf.
assert.doesNotMatch(api, /drive\.google|googleusercontent|uc\?id=/i,
  '3a. no direct/public/share Drive URL may appear');
assert.doesNotMatch(page, /drive\.google|googleusercontent|uc\?id=/i,
  '3b. the page must never reference Drive');
assert.doesNotMatch(api, /[?&]objectKey|object_key\s*[:=]/,
  '3c. object keys must never become caller authority or query parameters');
assert.doesNotMatch(page, /objectKey/,
  '3d. the page must not know object keys at all');

// 4. Truthful fail-closed states for every documented denial class.
for (const marker of ["status === 401", "status === 403", "status === 404", "status === 409", "status >= 500"]) {
  assert.ok(api.includes(marker), `4. byte fetch must map ${marker} to a truthful state`);
}
assert.ok(api.includes('DOCUMENT_ACCESS_DENIED') && api.includes('AUDIT_UNAVAILABLE'),
  '4. backend denial codes must drive the copy');

// 5. The document list comes from the review context, and the API-mode
// response is normalized to the shape the page renders.
assert.match(api, /documents\?: ApplicationDocumentSummary\[\];/,
  '5a. review context must carry opaque document summaries');
assert.match(api, /documents: raw\.documents \?\? \[\]/,
  '5b. API-mode normalization must pass the server document list through');
assert.match(api, /privateVerification: \{[\s\S]*raw\.reviewBasis\?\.applicantDisplayName/,
  '5c. API-mode normalization must map reviewBasis into the rendered shape');

// 6. Reviewer status matrix: rejected stays denied (button disabled AND the
// handler double-guards), pending/changes_requested/approved may open.
assert.match(page, /disabled=\{busy \|\| docBusy !== null \|\| context\.status === 'rejected'\}/,
  '6a. rejected applications must render disabled open buttons');
assert.match(page, /if \(!context \|\| context\.status === 'rejected'\) \{[\s\S]*setDocError/,
  '6b. the open handler must fail closed even if invoked outside the disabled control');

// 7. Backend headers decide presentation: inline images preview, attachment
// (PDF) downloads; errors surface in an alert state.
assert.match(api, /inline: disposition\.startsWith\('inline'\) \|\| mimeType\.startsWith\('image\/'\)/,
  '7a. inline decision must follow backend content-disposition/content-type');
assert.match(page, /if \(opened\.inline\) \{\s*setPreviewUrl\(url\);/,
  '7b. inline documents render in place');
assert.match(page, /anchor\.download = `application-document-\$\{documentId\}\.pdf`/,
  '7c. attachment documents download via a local blob URL');
assert.match(page, /URL\.revokeObjectURL\(url\)/,
  '7d. download blob URLs must be revoked');
assert.match(page, /className="review-document-error" role="alert"/,
  '7e. access failures must render a truthful alert state');
assert.match(page, /반려된 신청의 서류는 열람할 수 없습니다\./,
  '7f. rejected state must carry truthful Korean copy');

console.log('PASS #312 reviewer private-document UI: canonical admin byte route, authenticated fetch, no Drive/objectKey authority, rejected stays denied, header-driven open, truthful fail-closed states');
