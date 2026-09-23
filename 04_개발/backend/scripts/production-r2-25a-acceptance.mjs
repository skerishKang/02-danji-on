import { pathToFileURL } from 'node:url';

const PROD_API = 'padiem-danjion-api-production.padiem.workers.dev';
const PROD_PAGES = 'danjion.pages.dev';
const COMPLEX = 'banglim-myeongji-roadhill';
const OBJECT_KEY = /^gdrive\/public\/business-image\/[A-Za-z0-9_-]{8,}$/;

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`PRODUCTION_25A_MISSING_INPUT:${name}`);
  return value;
};

const assert = (condition, code) => {
  if (!condition) throw new Error(`PRODUCTION_25A_${code}`);
};

const origin = (raw, expectedHost, label) => {
  const value = new URL(raw);
  assert(value.protocol === 'https:' && value.hostname === expectedHost && value.pathname === '/' && !value.search && !value.hash, `UNSAFE_${label}_TARGET`);
  return value.origin;
};

const headers = (originValue, jwt = '') => ({
  accept: 'application/json',
  origin: originValue,
  ...(jwt ? { authorization: `Bearer ${jwt}` } : {})
});

const setCookie = (response) => (typeof response.headers.getSetCookie === 'function'
  ? response.headers.getSetCookie().map((value) => value.split(';', 1)[0]?.trim()).filter(Boolean).join('; ')
  : '');

const json = (response) => response.json().catch(() => null);

const request = async (url, init = {}) => {
  const method = init.method || 'GET';
  const response = await fetch(url, { ...init, redirect: 'manual' });
  return { response, body: await json(response) };
};

const png = () => {
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32BE(0x89504e47, 0);
  bytes.writeUInt32BE(0x0d0a1a0a, 4);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(8, 16);
  bytes.writeUInt32BE(8, 20);
  return new Uint8Array(bytes);
};

async function main() {
  assert(process.env.APP_ENV === 'production', 'APP_ENV');
  assert(!process.env.DATABASE_URL && !process.env.DANJION_PRODUCTION_DB_URL, 'DB_AUTHORITY_FORBIDDEN');
  const api = origin(required('DANJION_PRODUCTION_API_URL'), PROD_API, 'API');
  const pages = origin(required('DANJION_PRODUCTION_FRONTEND_URL'), PROD_PAGES, 'PAGES');
  const email = required('DANJION_PRODUCTION_25A_EMAIL');
  const password = required('DANJION_PRODUCTION_25A_PASSWORD');
  assert(password.length >= 8, 'PASSWORD_INVALID');

  console.log('PRODUCTION_ONLY_EXACT_TARGET_GUARD=PASS');
  console.log('ONE_PREEXISTING_ACCEPTANCE_ACCOUNT_ONLY=YES');
  console.log('ACCOUNT_PROVISIONING=0');
  console.log('HOUSEHOLD_PROVISIONING=0');
  console.log('SECRET_OUTPUT=0');
  console.log('AUTO_RETRY_FOR_MUTATIONS=0');
  console.log('PRODUCTION_PRODUCT_DATA_MUTATION_SCOPE=upload+application_create+invalid_reference_probe+referenced_delete_guard');

  const signIn = await request(new URL('/api/auth/sign-in/email', pages), {
    method: 'POST',
    headers: { ...headers(pages), 'content-type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  assert(signIn.response.status === 200, `SIGNIN_HTTP_${signIn.response.status}`);
  const cookie = setCookie(signIn.response);
  const bearer = signIn.response.headers.get('set-auth-token')?.trim() || '';
  let jwt = signIn.response.headers.get('set-auth-jwt')?.trim() || '';
  if (!jwt) {
    const token = await request(new URL('/api/auth/token', pages), { headers: { ...headers(pages), ...(cookie ? { cookie } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } });
    assert(token.response.ok, `TOKEN_HTTP_${token.response.status}`);
    jwt = String(token.body?.token || '').trim();
  }
  assert(jwt, 'JWT_MISSING');
  console.log('SIGNIN=PASS');

  const idempotency = `prod-25a-${Date.now()}`;
  const form = new FormData();
  form.set('kind', 'business-image');
  form.set('complexSlug', COMPLEX);
  form.set('file', new File([png()], `${idempotency}.png`, { type: 'image/png' }));
  const upload = await request(new URL('/api/v1/storage/objects', api), {
    method: 'POST',
    headers: { ...headers(pages, jwt), 'idempotency-key': idempotency },
    body: form
  });
  assert(upload.response.status === 201, `UPLOAD_HTTP_${upload.response.status}`);
  const objectKey = String(upload.body?.data?.objectKey || '');
  assert(OBJECT_KEY.test(objectKey), 'OBJECT_KEY_INVALID');
  console.log('R2_OBJECT_UPLOAD=PASS');
  console.log('OBJECT_KEY_RETURNED=PASS');

  const readback = await request(new URL(`/api/v1/storage/public?objectKey=${encodeURIComponent(objectKey)}`, api), { headers: headers(pages) });
  assert(readback.response.status === 200, `READBACK_HTTP_${readback.response.status}`);
  console.log('PUBLIC_OBJECT_READBACK=PASS');

  const app = await request(new URL('/api/v1/me/business-applications', api), {
    method: 'POST',
    headers: { ...headers(pages, jwt), 'content-type': 'application/json', 'idempotency-key': `${idempotency}-app` },
    body: JSON.stringify({
      complexSlug: COMPLEX,
      relationRaw: 'self',
      businessName: `Production 25A R2 ${idempotency}`,
      categoryName: '카페',
      serviceSummary: 'Bounded Production R2 25A acceptance',
      representativeImageObjectKey: objectKey
    })
  });
  assert(app.response.status === 201, `ATTACH_HTTP_${app.response.status}`);
  console.log('BUSINESS_APPLICATION_CREATE=PASS');
  console.log('REFERENCE_ATTACH=PASS');

  const invalid = await request(new URL('/api/v1/me/business-applications', api), {
    method: 'POST',
    headers: { ...headers(pages, jwt), 'content-type': 'application/json', 'idempotency-key': `${idempotency}-invalid` },
    body: JSON.stringify({ complexSlug: COMPLEX, relationRaw: 'self', businessName: `Invalid ref ${idempotency}`, categoryName: '카페', serviceSummary: 'Expected rejection', representativeImageObjectKey: 'gdrive/public/business-image/00000000-0000-0000-0000-000000000000' })
  });
  assert(invalid.response.status === 400, `INVALID_REFERENCE_HTTP_${invalid.response.status}`);
  console.log('INVALID_REFERENCE_REJECTION=PASS');

  const deleteAttempt = await request(new URL(`/api/v1/storage/objects?objectKey=${encodeURIComponent(objectKey)}`, api), {
    method: 'DELETE',
    headers: headers(pages, jwt)
  });
  assert(deleteAttempt.response.status === 409, `REFERENCE_DELETE_GUARD_HTTP_${deleteAttempt.response.status}`);
  console.log('REFERENCED_OBJECT_DELETE_GUARD=PASS');
  console.log('PRODUCTION_25A_ACCEPTANCE=PASS');
  console.log('ACCOUNT_PROVISIONING=0');
  console.log('HOUSEHOLD_PROVISIONING=0');
  console.log('SECRET_OUTPUT=0');

  await request(new URL('/api/auth/sign-out', pages), {
    method: 'POST',
    headers: { ...headers(pages), ...(cookie ? { cookie } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), 'content-type': 'application/json' },
    body: '{}'
  }).catch(() => null);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(String(error.message || error).replace(/password|token|cookie|authorization/gi, 'credential'));
    process.exitCode = 1;
  });
}
