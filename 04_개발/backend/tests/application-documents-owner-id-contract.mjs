import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [economy, docs] = await Promise.all([
  readFile(new URL('src/resident-economy-v2.ts', root), 'utf8'),
  readFile(new URL('src/resident-application-docs-v1.ts', root), 'utf8')
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

console.log('PASS #362 owner document identity: opaque row id in existing owner metadata only, fields/authorization/routes preserved');
