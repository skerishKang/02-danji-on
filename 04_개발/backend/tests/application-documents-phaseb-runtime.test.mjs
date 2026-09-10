import assert from 'node:assert/strict';
import {
  handleResidentApplicationDocumentWithSql,
  handleAdminApplicationDocumentWithSql
} from '../src/resident-application-docs-v1.ts';

// GAP-5 Phase-B runtime proof without Docker: the CENTRAL-required cases run
// the reviewed resident-application-docs-v1 handlers against stubbed sql()
// and a stubbed Drive (global fetch). No network, no database.

const APP_ID = '80000000-0000-4000-8000-000000000001';
const DOC_ID = '81000000-0000-4000-8000-000000000001';
const ACTOR_ID = '82000000-0000-4000-8000-000000000001';
const FOREIGN_ID = '82100000-0000-4000-8000-000000000001';
const COMPLEX_ID = '83000000-0000-4000-8000-000000000001';
const OBJECT_KEY = 'gdrive/private/application-document/stubFileId0123456789';
const MEDIA_BYTES = 'PDF-BYTES-STUB';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ENV = {
  DATABASE_URL: 'postgresql://unused-in-stub-test',
  APP_ENV: 'development',
  DEV_AUTH_BYPASS: 'true',
  GOOGLE_DRIVE_CLIENT_ID: 'stub-id',
  GOOGLE_DRIVE_CLIENT_SECRET: 'stub-secret',
  GOOGLE_DRIVE_REFRESH_TOKEN: 'stub-refresh'
};

const realFetch = globalThis.fetch;

function stubDrive({ mimeType = 'application/pdf', mediaOk = true } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const href = String(url);
    calls.push(href);
    if (href.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'stub-token', expires_in: 3600 }), {
        headers: { 'content-type': 'application/json' }
      });
    }
    if (href.includes('www.googleapis.com/drive/v3/files/')) {
      if (href.includes('alt=media')) {
        if (!mediaOk) return new Response('drive down', { status: 500 });
        return new Response(MEDIA_BYTES, { headers: { 'content-length': String(MEDIA_BYTES.length) } });
      }
      return new Response(JSON.stringify({ id: 'stubFileId0123456789', mimeType, size: String(MEDIA_BYTES.length) }), {
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response('unexpected', { status: 500 });
  };
  return calls;
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

function stubSql({
  status = 'pending',
  applicant = ACTOR_ID,
  documentPresent = true,
  registry = { kind: 'application-document', state: 'active' },
  grants = true,
  auditThrows = false
} = {}) {
  const seen = [];
  const sql = async (strings, ...values) => {
    const text = strings.join('?');
    seen.push({ text, values });
    if (text.includes('from business_application_documents bad')) {
      // Emulate PostgreSQL ::uuid casts: malformed ids reject at the driver.
      for (const value of values) {
        if (typeof value === 'string' && !UUID_V4.test(value)) {
          throw new Error('invalid_text_representation');
        }
      }
      return documentPresent ? [{
        object_key: OBJECT_KEY,
        complex_slug: 'phaseb-complex',
        applicant_user_id: applicant,
        application_status: status,
        registry_state: registry ? registry.state : null,
        registry_kind: registry ? registry.kind : null
      }] : [];
    }
    if (text.includes('insert into audit_events')) {
      if (auditThrows && text.includes("'document.read'")) throw new Error('audit down');
      return [{ id: '84000000-0000-4000-8000-000000000001' }];
    }
    if (text.includes('padiem_operator_grants')) {
      return grants ? [{
        complex_id: COMPLEX_ID,
        complex_slug: 'phaseb-complex',
        padiem_grant_id: '85000000-0000-4000-8000-000000000001',
        padiem_granted_scope: 'business.review',
        council_grant_id: null,
        council_granted_scope: null
      }] : [];
    }
    if (text.includes('from app_users') && text.includes('where auth_user_id =')) {
      return [{ id: ACTOR_ID, auth_user_id: values[0], display_name: 'Stub', account_status: 'active' }];
    }
    return [];
  };
  return { sql, seen };
}

function getRequest(url) {
  return new Request(url, {
    method: 'GET',
    headers: { 'x-danjion-dev-auth-user': 'stub-subject' }
  });
}

const mineUrl = `http://test/api/v1/me/business-applications/${APP_ID}/documents/${DOC_ID}`;
const adminUrl = `http://test/api/v1/admin/business-applications/${APP_ID}/documents/${DOC_ID}`;

// 1. applicant pending allowed
{
  const driveCalls = stubDrive();
  try {
    const { sql, seen } = stubSql({ status: 'pending' });
    const res = await handleResidentApplicationDocumentWithSql(getRequest(mineUrl), ENV, sql, 'pb-01');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.equal(res.headers.get('content-disposition'), `attachment; filename="application-document-${DOC_ID}.pdf"`);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await res.text(), MEDIA_BYTES);
    assert.ok(!seen.some((q) => q.text.includes('insert into audit_events')),
      'applicant read stays unaudited for MVP');
  } finally {
    restoreFetch();
  }
  assert.ok(driveCalls.some((u) => u.includes('alt=media')), 'allowed read must proxy Drive media');
  console.log('PASS 01 applicant pending allowed');
}

// 2. applicant rejected allowed
{
  stubDrive();
  try {
    const { sql } = stubSql({ status: 'rejected' });
    const res = await handleResidentApplicationDocumentWithSql(getRequest(mineUrl), ENV, sql, 'pb-02');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), MEDIA_BYTES);
  } finally {
    restoreFetch();
  }
  console.log('PASS 02 applicant rejected allowed');
}

// 3. foreign applicant denied, non-disclosing, no Drive touch
{
  const driveCalls = stubDrive();
  try {
    const { sql } = stubSql({ status: 'pending', applicant: FOREIGN_ID });
    const res = await handleResidentApplicationDocumentWithSql(getRequest(mineUrl), ENV, sql, 'pb-03');
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.code, 'NOT_FOUND');
  } finally {
    restoreFetch();
  }
  assert.equal(driveCalls.length, 0, 'denied read must never touch Drive');
  console.log('PASS 03 foreign applicant denied');
}

// 4. reviewer pending allowed
{
  stubDrive();
  try {
    const { sql } = stubSql({ status: 'pending' });
    const res = await handleAdminApplicationDocumentWithSql(getRequest(adminUrl), ENV, sql, 'pb-04');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), MEDIA_BYTES);
  } finally {
    restoreFetch();
  }
  console.log('PASS 04 reviewer pending allowed');
}

// 5. reviewer approved allowed
{
  stubDrive();
  try {
    const { sql } = stubSql({ status: 'approved' });
    const res = await handleAdminApplicationDocumentWithSql(getRequest(adminUrl), ENV, sql, 'pb-05');
    assert.equal(res.status, 200);
  } finally {
    restoreFetch();
  }
  console.log('PASS 05 reviewer approved allowed');
}

// 6. reviewer rejected denied, no Drive touch
{
  const driveCalls = stubDrive();
  try {
    const { sql } = stubSql({ status: 'rejected' });
    const res = await handleAdminApplicationDocumentWithSql(getRequest(adminUrl), ENV, sql, 'pb-06');
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, 'DOCUMENT_ACCESS_DENIED');
  } finally {
    restoreFetch();
  }
  assert.equal(driveCalls.length, 0, 'rejected reviewer read must never touch Drive');
  console.log('PASS 06 reviewer rejected denied');
}

// 7. reviewer wrong-complex denied
{
  const driveCalls = stubDrive();
  try {
    const { sql } = stubSql({ status: 'pending', grants: false });
    const res = await handleAdminApplicationDocumentWithSql(getRequest(adminUrl), ENV, sql, 'pb-07');
    assert.ok(res.status === 403 || res.status === 404, `wrong-complex reviewer must be denied, got ${res.status}`);
  } finally {
    restoreFetch();
  }
  assert.equal(driveCalls.length, 0, 'wrong-complex read must never touch Drive');
  console.log('PASS 07 reviewer wrong-complex denied');
}

// 8. kind mismatch denied
{
  const driveCalls = stubDrive();
  try {
    const { sql } = stubSql({ status: 'pending', registry: { kind: 'business-image', state: 'active' } });
    const res = await handleAdminApplicationDocumentWithSql(getRequest(adminUrl), ENV, sql, 'pb-08');
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'DOCUMENT_KIND_INVALID');
  } finally {
    restoreFetch();
  }
  assert.equal(driveCalls.length, 0, 'kind mismatch must never touch Drive');
  console.log('PASS 08 kind mismatch denied');
}

// 9. inactive registry denied
{
  const driveCalls = stubDrive();
  try {
    const { sql } = stubSql({ status: 'pending', registry: { kind: 'application-document', state: 'retired' } });
    const res = await handleAdminApplicationDocumentWithSql(getRequest(adminUrl), ENV, sql, 'pb-09');
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error.code, 'DOCUMENT_NOT_ACTIVE');
  } finally {
    restoreFetch();
  }
  assert.equal(driveCalls.length, 0, 'inactive registry must never touch Drive');
  console.log('PASS 09 inactive registry denied');
}

// 10. document.read audit emitted
{
  stubDrive();
  let audit;
  try {
    const { sql, seen } = stubSql({ status: 'pending' });
    const res = await handleAdminApplicationDocumentWithSql(getRequest(adminUrl), ENV, sql, 'pb-10');
    assert.equal(res.status, 200);
    audit = seen.findLast((q) => q.text.includes('insert into audit_events') && q.text.includes('document.read'));
  } finally {
    restoreFetch();
  }
  assert.ok(audit, 'reviewer read must emit a document.read audit row');
  assert.ok(audit.text.includes("'operator'"), 'audit actor kind must be operator');
  assert.ok(audit.text.includes("'allowed'"), 'audit decision must be allowed');
  console.log('PASS 10 document.read audit emitted');
}

// 11. audit failure blocks reviewer read
{
  const driveCalls = stubDrive();
  try {
    const { sql } = stubSql({ status: 'pending', auditThrows: true });
    const res = await handleAdminApplicationDocumentWithSql(getRequest(adminUrl), ENV, sql, 'pb-11');
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error.code, 'AUDIT_UNAVAILABLE');
  } finally {
    restoreFetch();
  }
  assert.equal(driveCalls.length, 0, 'audit failure must block before any Drive touch');
  console.log('PASS 11 audit failure blocks reviewer read');
}

// 12. no public URL / arbitrary caller objectKey ignored
{
  stubDrive();
  let res;
  try {
    const { sql } = stubSql({ status: 'pending' });
    res = await handleResidentApplicationDocumentWithSql(
      getRequest(`${mineUrl}?objectKey=gdrive/public/business-image/evil`),
      ENV, sql, 'pb-12'
    );
    assert.equal(res.status, 200);
    assert.equal(await res.text(), MEDIA_BYTES, 'caller objectKey must not steer the read');
  } finally {
    restoreFetch();
  }
  for (const [name, value] of res.headers) {
    assert.ok(!String(value).includes('gdrive/'), `header ${name} must not leak object keys`);
    assert.ok(!String(value).includes('drive.google'), `header ${name} must not leak Drive URLs`);
    assert.ok(!String(value).includes('stubFileId'), `header ${name} must not leak file ids`);
  }
  console.log('PASS 12 no public URL / arbitrary objectKey ignored');
}

// 13. malformed ids fail closed without disclosure
{
  const driveCalls = stubDrive();
  let res;
  try {
    const { sql, seen } = stubSql({ status: 'pending' });
    res = await handleResidentApplicationDocumentWithSql(
      getRequest(`http://test/api/v1/me/business-applications/12345/documents/${DOC_ID}`),
      ENV, sql, 'pb-13'
    );
    assert.equal(seen.length, 0, 'malformed id must fail before any query');
  } finally {
    restoreFetch();
  }
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, 'NOT_FOUND');
  assert.equal(driveCalls.length, 0, 'malformed id must never touch Drive');
  console.log('PASS 13 malformed ids fail closed');
}

// 14. applicant approved allowed
{
  stubDrive();
  try {
    const { sql } = stubSql({ status: 'approved' });
    const res = await handleResidentApplicationDocumentWithSql(getRequest(mineUrl), ENV, sql, 'pb-14');
    assert.equal(res.status, 200);
  } finally {
    restoreFetch();
  }
  console.log('PASS 14 applicant approved allowed');
}

// 15. reviewer changes_requested allowed
{
  stubDrive();
  try {
    const { sql } = stubSql({ status: 'changes_requested' });
    const res = await handleAdminApplicationDocumentWithSql(getRequest(adminUrl), ENV, sql, 'pb-15');
    assert.equal(res.status, 200);
  } finally {
    restoreFetch();
  }
  console.log('PASS 15 reviewer changes_requested allowed');
}

// 16. image inline disposition
{
  stubDrive({ mimeType: 'image/png' });
  try {
    const { sql } = stubSql({ status: 'pending' });
    const res = await handleResidentApplicationDocumentWithSql(getRequest(mineUrl), ENV, sql, 'pb-16');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('content-disposition'), `inline; filename="application-document-${DOC_ID}"`);
  } finally {
    restoreFetch();
  }
  console.log('PASS 16 image inline disposition');
}

console.log('PASS GAP-5 Phase-B runtime: 12 required cases plus guards and disposition (stub SQL + stub Drive)');
