import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const reviewContext = await readFile(new URL('src/admin-review-context-v1.ts', root), 'utf8');

// 1. The review context is the reviewer document-metadata authority: it lists
// opaque document ids (the byte-route key), kind, and sort order only.
assert.match(
  reviewContext,
  /select id, document_kind, sort_order\s+from business_application_documents\s+where application_id = \$\{applicationId\}::uuid\s+order by sort_order asc/,
  '1. document summaries must read id/document_kind/sort_order scoped to the application'
);
assert.match(reviewContext, /const documents = await readApplicationDocumentSummaries\(sql, String\(row\.id\)\);/,
  '2. the handler must resolve document summaries for the reviewed application');
assert.match(reviewContext, /approvedBusinessId: row\.approved_business_id,\s*documents,/,
  '3. the review-context payload must expose the documents list');

// 4. No object-key authority leaks through the listing: the summary query must
// never select the storage column, so the reviewer UI can only address
// documents by id through the byte route.
const summaryQuery = reviewContext.match(/readApplicationDocumentSummaries[\s\S]*?order by sort_order asc\s*`/);
assert.ok(summaryQuery, '4. document summary reader must exist');
assert.equal(summaryQuery[0].includes('object_key'), false,
  '4. document summaries must never select the object key');

// 5. Residence privacy invariants from GAP-4 stay intact.
assert.equal(reviewContext.includes('building_code'), false, '5. residence building code must stay absent');
assert.equal(reviewContext.includes('unit_code'), false, '5. residence unit code must stay absent');
assert.equal(reviewContext.includes('evidence_object_key'), false, '5. verification evidence key must stay absent');

// 6. Summaries are read after requireOperationalAuthority so a caller without
// business.review authority learns nothing about the document set.
assert.ok(reviewContext.indexOf('requireOperationalAuthority(') < reviewContext.indexOf('readApplicationDocumentSummaries(sql, String(row.id))'),
  '6. document summaries must be read only after operational authority passes');

console.log('PASS #312 review-context document summaries: opaque id/kind/sort-order listing, no object-key authority, authority-ordered read, residence privacy intact');
