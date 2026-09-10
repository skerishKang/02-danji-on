import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [economy, docs, core] = await Promise.all([
  readFile(new URL('src/resident-economy-v2.ts', root), 'utf8'),
  readFile(new URL('src/resident-application-docs-v1.ts', root), 'utf8'),
  readFile(new URL('src/core-v1.ts', root), 'utf8')
]);

// 1. The owner document reader selects the row id alongside the existing
// fields, from business_application_documents, scoped to one application.
assert.match(
  economy,
  /select id, object_key, document_kind, sort_order\s+from business_application_documents\s+where application_id = \$\{applicationId\}::uuid\s+order by sort_order/,
  '1. getApplicationDocuments must select business_application_documents.id with the existing fields'
);
assert.match(economy, /id: String\(row\.id\),\s*objectKey: row\.object_key,/,
  '2. the response must expose the row id as the first opaque field, keeping objectKey/kind/sortOrder');
assert.match(economy, /type ApplicationDocumentResponse = \{\s*id: string;/,
  '3. the typed owner document response must include id');

// 4. The id rides only the EXISTING owner metadata surfaces: replay, create,
// update, and resubmit all embed getApplicationDocuments output.
const callSites = economy.match(/getApplicationDocuments\(sql, /g) ?? [];
assert.equal(callSites.length, 4, '4. exactly the four existing owner metadata call sites must remain');
assert.ok(economy.includes('documents: docs, idempotency_replayed: true') &&
  economy.includes('documents: docs, idempotency_replayed: false') &&
  economy.includes('{ ...updated, documents: docs }') &&
  economy.includes('{ ...updatedRows[0], documents: docs }'),
  '4. replay/create/update/resubmit responses must keep embedding the documents array');

// 5. Authorization unchanged: the owner update path still binds the
// application row to the acting applicant before any document read.
assert.ok(economy.includes('and a.applicant_user_id = ${actor.id}::uuid'),
  '5. owner application binding must remain on the mutation path');

// 6. No new routes and no byte-serving changes: the owner metadata module
// never serves document bytes, and the byte route module is untouched by this
// contract (still me/admin route pair, still id-keyed lookup).
assert.doesNotMatch(economy, /documents\/\$\{|ME_DOCUMENT_ROUTE|streamDriveFile/,
  '6a. resident-economy must not gain any document byte route');
assert.ok(docs.includes('ME_DOCUMENT_ROUTE') && docs.includes('ADMIN_DOCUMENT_ROUTE') &&
  docs.includes('where bad.id = ${documentId}::uuid'),
  '6b. the byte route must remain the id-keyed me/admin pair from #310');

// 7. Part B: the owner application LIST in core-v1 attaches documents[] to
// every row, scoped through the already actor-filtered application set
// (correlated d.application_id = a.id under applicant_user_id = actor.id),
// coalescing to a truthful [] for applications without documents.
assert.ok(core.includes("request.method === 'GET' && path === '/api/v1/me/business-applications'"),
  '7a. the owner list route string must be unchanged (no new route)');
assert.match(core, /where a\.applicant_user_id = \$\{actor\.id\}::uuid/,
  '7b. the list must stay actor-filtered');
assert.match(core, /coalesce\(\(\s*select json_agg\(json_build_object\(\s*'id', d\.id,\s*'objectKey', d\.object_key,\s*'kind', d\.document_kind,\s*'sortOrder', d\.sort_order\s*\) order by d\.sort_order\)\s*from business_application_documents d\s*where d\.application_id = a\.id\s*\), '\[\]'::json\) as documents/,
  '7c. the list must expose id/objectKey/kind/sortOrder documents[] scoped to the owned application row, defaulting to []');
assert.match(core, /select a\.id, c\.slug as complex_slug, a\.relation_type, a\.relation_raw,\s*a\.resolved_relation_type, a\.business_name,\s*a\.category_name, a\.service_summary, a\.status, a\.review_note,\s*a\.approved_business_id, a\.created_at, a\.updated_at,/,
  '7d. every pre-existing list field must remain in the same order');
assert.match(core, /order by a\.created_at desc\s+`\s*;\s*return ok\(rows, id\)/,
  '7e. created_at desc ordering and the plain rows response must be preserved');

// 8. The list path is read-only over documents: core-v1 never writes
// business_application_documents and never serves bytes.
assert.equal(core.includes('insert into business_application_documents'), false,
  '8a. core-v1 must not write document rows');
assert.equal(core.includes('delete from business_application_documents'), false,
  '8b. core-v1 must not delete document rows');
assert.doesNotMatch(core, /documents\/\$\{|streamDriveFile/,
  '8c. core-v1 must not gain any document byte route');

// 9. Part B ships with the real-Postgres lifecycle proof of the same query.
const lifecycle = await readFile(new URL('tests/application-documents-owner-list-postgres-lifecycle.sh', root), 'utf8');
assert.ok(lifecycle.includes("where a.applicant_user_id = '$1'::uuid") &&
  lifecycle.includes("), '[]'::json) as documents") &&
  lifecycle.includes('owner B response never contains owner A document identity'),
  '9. the postgres lifecycle must run the mirrored query and prove cross-owner isolation');

console.log('PASS #362 owner document identity: opaque row id in existing owner metadata only, fields/authorization/routes preserved');
