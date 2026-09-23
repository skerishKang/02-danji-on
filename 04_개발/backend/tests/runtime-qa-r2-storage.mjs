import { pathToFileURL } from 'node:url';

export const PROD_API_HOST = 'padiem-danjion-api-production.padiem.workers.dev';
export const PROD_PAGES_HOST = 'danjion.pages.dev';
export const QA_API_PREFIX = 'padiem-danjion-api-qa.';
export const QA_PAGES_HOST = 'danjion-qa.pages.dev';

export const STATUS = Object.freeze({
  PASS: 'PASS',
  APPLICATION_FAILURE: 'APPLICATION_FAILURE',
  AUTH_FAILURE: 'AUTH_FAILURE',
  RATE_LIMITED: 'RATE_LIMITED',
  INFRA_FAILURE: 'INFRA_FAILURE',
  HARNESS_FAILURE: 'HARNESS_FAILURE'
});

export const OWNER_RELATION_RAW_VALUES = Object.freeze(['self', 'co', 'family', 'etc']);
export const OWNER_RELATION_PROJECTION_VALUES = Object.freeze([
  'resident',
  'resident_family',
  'neighbor',
  'local'
]);
export const OWNER_RELATION_PRE_RESOLVE_MAP = Object.freeze({
  self: 'resident',
  co: 'neighbor',
  family: 'resident_family',
  etc: 'local'
});

export const VALID_OBJECT_KEY_RE = /^gdrive\/(public|private)\/(business-image|application-document|official-news-image)\/[A-Za-z0-9_-]{8,}$/;

export const RETRY_POLICY = Object.freeze({
  networkAttempts: 3,
  serverAttempts: 3,
  timeoutMs: 15000,
  backoffBaseMs: 500
});

export function redactSecrets(text) {
  if (text == null) return '';
  return String(text)
    .replace(/(password|passwd|pwd|token|jwt|cookie|authorization|set-auth-jwt|set-auth-token)\s*[:=]\s*("?)[^",\s}]+/gi,
      '$1=***$2')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, 'JWT_REDACTED')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, 'Bearer ***');
}

export function classifyHttpStatus(status) {
  if (status >= 200 && status < 300) return STATUS.PASS;
  if (status === 401) return STATUS.AUTH_FAILURE;
  if (status === 403) return STATUS.AUTH_FAILURE;
  if (status === 429) return STATUS.RATE_LIMITED;
  if (status >= 500 && status <= 599) return STATUS.APPLICATION_FAILURE;
  if (status >= 400 && status <= 499) return STATUS.APPLICATION_FAILURE;
  return STATUS.APPLICATION_FAILURE;
}

export function classifyError(error) {
  const code = error?.cause?.code || error?.code || '';
  const name = error?.name || '';
  if (name === 'AbortError' || code === 'ABORT_ERR' || /timeout/i.test(String(error?.message || ''))) {
    return STATUS.INFRA_FAILURE;
  }
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'UND_ERR_SOCKET', 'EPIPE'].includes(code)) {
    return STATUS.INFRA_FAILURE;
  }
  if (error instanceof TypeError && /fetch|network/i.test(String(error.message || ''))) {
    return STATUS.INFRA_FAILURE;
  }
  return STATUS.INFRA_FAILURE;
}

export function isRetryableNetworkError(error) {
  return classifyError(error) === STATUS.INFRA_FAILURE;
}

export function isRetryableStatus(status) {
  return status === 500 || status === 502 || status === 503 || status === 504;
}

export function shouldRetry({ attempt, maxAttempts, status, error }) {
  if (attempt >= maxAttempts) return false;
  if (error) return isRetryableNetworkError(error);
  if (status != null) return isRetryableStatus(status);
  return false;
}

export function parseRetryAfterMs(response) {
  const raw = response?.headers?.get?.('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 120000);
  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) return Math.min(Math.max(dateMs - Date.now(), 0), 120000);
  return null;
}

export function assertRemoteOnly({ remoteFlag, envRemote, apiUrl }) {
  const explicit = remoteFlag === true || envRemote === '1' || envRemote === 'true';
  if (!explicit) {
    const err = new Error('REMOTE_ONLY_REQUIRED: pass --remote or set DANJION_QA_REMOTE=1');
    err.harnessCode = 'REMOTE_ONLY_REQUIRED';
    throw err;
  }
  const url = new URL(apiUrl);
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === '::1') {
    const err = new Error('LOCAL_TARGET_FORBIDDEN: remote-only harness must not target loopback');
    err.harnessCode = 'LOCAL_TARGET_FORBIDDEN';
    throw err;
  }
  if (url.protocol !== 'https:') {
    const err = new Error('HTTPS_REQUIRED');
    err.harnessCode = 'HTTPS_REQUIRED';
    throw err;
  }
}

export function assertNonProductionTargets(apiBase, pagesBase) {
  const api = new URL(apiBase);
  const pages = new URL(pagesBase);
  if (api.hostname === PROD_API_HOST) {
    const err = new Error('PRODUCTION_API_TARGET_FORBIDDEN');
    err.harnessCode = 'PRODUCTION_API_TARGET_FORBIDDEN';
    throw err;
  }
  if (pages.hostname === PROD_PAGES_HOST) {
    const err = new Error('PRODUCTION_PAGES_TARGET_FORBIDDEN');
    err.harnessCode = 'PRODUCTION_PAGES_TARGET_FORBIDDEN';
    throw err;
  }
  if (!api.hostname.startsWith(QA_API_PREFIX) || !api.hostname.endsWith('.workers.dev')) {
    const err = new Error('QA_API_TARGET_INVALID');
    err.harnessCode = 'QA_API_TARGET_INVALID';
    throw err;
  }
  if (pages.hostname !== QA_PAGES_HOST) {
    const err = new Error('QA_PAGES_TARGET_INVALID');
    err.harnessCode = 'QA_PAGES_TARGET_INVALID';
    throw err;
  }
}

export function validateFixtures(input) {
  const errors = [];
  const email = String(input.email || '').trim();
  const password = String(input.password || '');
  const complexSlug = String(input.complexSlug || '').trim();
  const relationRaw = String(input.relationRaw || '').trim();
  const relationType = String(input.relationType || '').trim();
  const businessName = String(input.businessName || '').trim();
  const categoryName = String(input.categoryName || '').trim();
  const serviceSummary = String(input.serviceSummary || '').trim();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push('INVALID_FIXTURE_EMAIL');
  if (password.length < 8) errors.push('INVALID_FIXTURE_PASSWORD');
  if (!/^[a-z0-9-]{3,}$/.test(complexSlug)) errors.push('INVALID_FIXTURE_COMPLEX_SLUG');
  if (!OWNER_RELATION_RAW_VALUES.includes(relationRaw)) errors.push('INVALID_FIXTURE_RELATION_RAW_ENUM');
  if (relationType) {
    if (!OWNER_RELATION_PROJECTION_VALUES.includes(relationType)) {
      errors.push('INVALID_FIXTURE_RELATION_TYPE_ENUM');
    } else if (OWNER_RELATION_PRE_RESOLVE_MAP[relationRaw] !== relationType) {
      errors.push('INVALID_FIXTURE_RELATION_MISMATCH');
    }
  }
  if (!businessName) errors.push('INVALID_FIXTURE_BUSINESS_NAME');
  if (!categoryName) errors.push('INVALID_FIXTURE_CATEGORY_NAME');
  if (!serviceSummary) errors.push('INVALID_FIXTURE_SERVICE_SUMMARY');

  return {
    ok: errors.length === 0,
    errors,
    fixture: {
      email,
      password,
      complexSlug,
      relationRaw,
      relationType,
      businessName,
      categoryName,
      serviceSummary
    }
  };
}

export function validateObjectKey(objectKey) {
  return VALID_OBJECT_KEY_RE.test(String(objectKey || ''));
}

export function stepResult(name, status, detail = {}) {
  return {
    name,
    status,
    httpStatus: detail.httpStatus ?? null,
    code: detail.code ?? null,
    retryAfterMs: detail.retryAfterMs ?? null,
    attempts: detail.attempts ?? 0,
    note: detail.note ?? null
  };
}

export function summarizeResults(results) {
  const counts = {
    PASS: 0,
    APPLICATION_FAILURE: 0,
    AUTH_FAILURE: 0,
    RATE_LIMITED: 0,
    INFRA_FAILURE: 0,
    HARNESS_FAILURE: 0
  };
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  const harnessFailure = counts.HARNESS_FAILURE > 0;
  const authFailure = !harnessFailure && counts.AUTH_FAILURE > 0;
  const infraFailure = !harnessFailure && !authFailure && counts.INFRA_FAILURE > 0;
  const rateLimited = !harnessFailure && !authFailure && !infraFailure && counts.RATE_LIMITED > 0;
  const applicationFailure = !harnessFailure && !authFailure && !infraFailure && !rateLimited
    && counts.APPLICATION_FAILURE > 0;
  let overall = STATUS.PASS;
  if (harnessFailure) overall = STATUS.HARNESS_FAILURE;
  else if (authFailure) overall = STATUS.AUTH_FAILURE;
  else if (infraFailure) overall = STATUS.INFRA_FAILURE;
  else if (rateLimited) overall = STATUS.RATE_LIMITED;
  else if (applicationFailure) overall = STATUS.APPLICATION_FAILURE;
  return { counts, overall };
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    const err = new Error(`MISSING_REQUIRED_QA_INPUT:${name}`);
    err.harnessCode = 'MISSING_REQUIRED_QA_INPUT';
    throw err;
  }
  return value;
}

function cookieHeader(response) {
  const values = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  return values.map((v) => v.split(';', 1)[0]?.trim()).filter(Boolean).join('; ');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchClassified(url, init, policy = RETRY_POLICY) {
  const maxAttempts = init?.method && init.method !== 'GET' && init.method !== 'HEAD'
    ? 1
    : policy.networkAttempts;
  const method = init?.method || 'GET';
  let attempt = 0;
  let lastError = null;
  let lastResponse = null;

  while (attempt < Math.max(maxAttempts, 1)) {
    attempt += 1;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
      let response;
      try {
        response = await fetch(url, { ...init, signal: controller.signal, redirect: 'manual' });
      } finally {
        clearTimeout(timer);
      }
      lastResponse = response;
      lastError = null;
      if (isRetryableStatus(response.status) && attempt < policy.networkAttempts) {
        await sleep(policy.backoffBaseMs * (2 ** (attempt - 1)));
        continue;
      }
      return { response, error: null, attempts: attempt };
    } catch (error) {
      lastError = error;
      lastResponse = null;
      if (isRetryableNetworkError(error) && attempt < policy.networkAttempts) {
        await sleep(policy.backoffBaseMs * (2 ** (attempt - 1)));
        continue;
      }
      return { response: null, error, attempts: attempt };
    }
  }
  return { response: lastResponse, error: lastError, attempts: attempt };
}

function makePngBytes() {
  const b = Buffer.alloc(64);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.write('IHDR', 12);
  b.writeUInt32BE(8, 16);
  b.writeUInt32BE(8, 20);
  return new Uint8Array(b);
}

function resultLine(r) {
  const parts = [`${r.name}=${r.status}`];
  if (r.httpStatus != null) parts.push(`status=${r.httpStatus}`);
  if (r.code) parts.push(`code=${r.code}`);
  if (r.retryAfterMs != null) parts.push(`retryAfterMs=${r.retryAfterMs}`);
  if (r.attempts) parts.push(`attempts=${r.attempts}`);
  if (r.note) parts.push(`note=${redactSecrets(r.note)}`);
  return parts.join(' ');
}

async function main() {
  const args = process.argv.slice(2);
  const remoteFlag = args.includes('--remote');
  const results = [];

  const push = (r) => {
    results.push(r);
    console.log(resultLine(r));
    return r;
  };

  try {
    assertRemoteOnly({
      remoteFlag,
      envRemote: process.env.DANJION_QA_REMOTE?.trim(),
      apiUrl: requiredEnv('DANJION_QA_API_URL')
    });
    const apiBase = new URL(requiredEnv('DANJION_QA_API_URL'));
    const pagesBase = new URL(requiredEnv('DANJION_QA_FRONTEND_URL'));
    assertNonProductionTargets(apiBase.href, pagesBase.href);

    const fixtureCheck = validateFixtures({
      email: requiredEnv('DANJION_QA_EMAIL'),
      password: requiredEnv('DANJION_QA_PASSWORD'),
      complexSlug: process.env.DANJION_QA_COMPLEX_SLUG?.trim() || 'banglim-myeongji-roadhill',
      relationRaw: process.env.DANJION_QA_RELATION_RAW?.trim() || 'self',
      relationType: process.env.DANJION_QA_RELATION_TYPE?.trim() || '',
      businessName: process.env.DANJION_QA_BUSINESS_NAME?.trim() || 'QA R2 Harness',
      categoryName: process.env.DANJION_QA_CATEGORY_NAME?.trim() || '카페',
      serviceSummary: process.env.DANJION_QA_SERVICE_SUMMARY?.trim() || 'QA R2 storage harness probe'
    });
    if (!fixtureCheck.ok) {
      push(stepResult('PREFLIGHT_FIXTURE', STATUS.HARNESS_FAILURE, {
        code: fixtureCheck.errors.join(','),
        note: 'fixture validation failed before network'
      }));
      throw Object.assign(new Error('FIXTURE_INVALID'), { harnessCode: 'FIXTURE_INVALID' });
    }
    const fx = fixtureCheck.fixture;
    const origin = pagesBase.origin;
    const api = (path) => new URL(path, apiBase.origin);

    console.log(`REMOTE_ONLY=YES`);
    console.log(`QA_ONLY=YES`);
    console.log(`PRODUCTION_TARGET=DENY`);
    console.log(`IDENTITY_SOURCE=ENV_DANJION_QA_EMAIL`);
    console.log(`QA_CREDENTIAL_BINDING=READY`);
    console.log(`QA_API_URL_BINDING=READY`);
    console.log(`SECRET_OUTPUT=NO`);

    const health = await fetchClassified(api('/api/health'), {
      headers: { accept: 'application/json' }
    });
    if (health.error || !health.response) {
      push(stepResult('A_HEALTH', classifyError(health.error), {
        attempts: health.attempts,
        note: health.error?.message || 'network failure'
      }));
      throw Object.assign(new Error('INFRA'), { harnessCode: 'INFRA' });
    }
    push(stepResult('A_HEALTH', classifyHttpStatus(health.response.status), {
      httpStatus: health.response.status,
      attempts: health.attempts
    }));
    if (health.response.status >= 400) {
      throw Object.assign(new Error('EARLY_STOP'), { harnessCode: 'EARLY_STOP' });
    }

    const signIn = await fetchClassified(api('/api/auth/sign-in/email'), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        origin
      },
      body: JSON.stringify({ email: fx.email, password: fx.password })
    });
    if (signIn.error || !signIn.response) {
      push(stepResult('B_SIGN_IN', classifyError(signIn.error), {
        attempts: signIn.attempts,
        note: signIn.error?.message || 'network failure'
      }));
      throw Object.assign(new Error('INFRA'), { harnessCode: 'INFRA' });
    }
    const signInStatus = classifyHttpStatus(signIn.response.status);
    push(stepResult('B_SIGN_IN', signInStatus, {
      httpStatus: signIn.response.status,
      attempts: signIn.attempts
    }));
    if (signIn.response.status === 429) {
      push(stepResult('B_AUTH', STATUS.RATE_LIMITED, {
        httpStatus: 429,
        retryAfterMs: parseRetryAfterMs(signIn.response)
      }));
      throw Object.assign(new Error('RATE_LIMITED'), { harnessCode: 'RATE_LIMITED' });
    }
    if (signIn.response.status >= 400) {
      throw Object.assign(new Error('AUTH'), { harnessCode: 'AUTH' });
    }

    let cookie = cookieHeader(signIn.response);
    let sessionBearer = signIn.response.headers.get('set-auth-token')?.trim() || '';
    let jwt = signIn.response.headers.get('set-auth-jwt')?.trim() || '';
    if (!jwt) {
      const token = await fetchClassified(api('/api/auth/token'), {
        headers: {
          accept: 'application/json',
          origin,
          ...(cookie ? { cookie } : {}),
          ...(sessionBearer ? { authorization: `Bearer ${sessionBearer}` } : {})
        }
      });
      if (token.response?.ok) {
        const tokenBody = await token.response.json().catch(() => null);
        jwt = typeof tokenBody?.token === 'string' ? tokenBody.token.trim() : '';
      }
    }
    if (!jwt) {
      push(stepResult('B_JWT', STATUS.AUTH_FAILURE, { note: 'session did not yield service JWT' }));
      throw Object.assign(new Error('AUTH'), { harnessCode: 'AUTH' });
    }
    push(stepResult('B_JWT', STATUS.PASS, { note: 'service JWT acquired (value not logged)' }));

    const idem = `r2h-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const form = new FormData();
    form.set('kind', 'business-image');
    form.set('complexSlug', fx.complexSlug);
    form.set('file', new File([makePngBytes()], `${idem}.png`, { type: 'image/png' }));
    const upload = await fetchClassified(api('/api/v1/storage/objects'), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        origin,
        authorization: `Bearer ${jwt}`,
        'idempotency-key': idem
      },
      body: form
    });
    if (upload.error || !upload.response) {
      push(stepResult('B_UPLOAD', classifyError(upload.error), {
        attempts: upload.attempts,
        note: upload.error?.message || 'network failure'
      }));
      throw Object.assign(new Error('INFRA'), { harnessCode: 'INFRA' });
    }
    const uploadBody = await upload.response.json().catch(() => null);
    const uploadStatus = classifyHttpStatus(upload.response.status);
    push(stepResult('B_UPLOAD', uploadStatus, {
      httpStatus: upload.response.status,
      code: uploadBody?.error?.code || null,
      attempts: upload.attempts
    }));
    if (upload.response.status === 429) {
      push(stepResult('B_UPLOAD_RATE', STATUS.RATE_LIMITED, {
        httpStatus: 429,
        retryAfterMs: parseRetryAfterMs(upload.response)
      }));
      throw Object.assign(new Error('RATE_LIMITED'), { harnessCode: 'RATE_LIMITED' });
    }
    if (upload.response.status >= 400) {
      throw Object.assign(new Error('APP_UPLOAD'), { harnessCode: 'APP_UPLOAD' });
    }

    const objectKey = uploadBody?.data?.objectKey || '';
    if (!validateObjectKey(objectKey)) {
      push(stepResult('C_OBJECT_KEY', STATUS.HARNESS_FAILURE, {
        code: 'INVALID_OBJECT_KEY_SHAPE',
        note: 'uploaded objectKey failed local shape validation'
      }));
      throw Object.assign(new Error('FIXTURE_INVALID'), { harnessCode: 'FIXTURE_INVALID' });
    }
    push(stepResult('C_OBJECT_KEY', STATUS.PASS, { note: 'objectKey shape valid' }));

    const streamOk = await fetchClassified(api(`/api/v1/storage/public?objectKey=${encodeURIComponent(objectKey)}`), {
      headers: { accept: '*/*', origin }
    });
    if (streamOk.error || !streamOk.response) {
      push(stepResult('D_STREAM_READBACK', classifyError(streamOk.error), {
        attempts: streamOk.attempts
      }));
    } else {
      push(stepResult('D_STREAM_READBACK', classifyHttpStatus(streamOk.response.status), {
        httpStatus: streamOk.response.status,
        attempts: streamOk.attempts
      }));
      if (streamOk.response.body) await streamOk.response.body.cancel().catch(() => {});
    }

    const missingKey = 'gdrive/public/business-image/00000000-0000-0000-0000-000000000000';
    const missing = await fetchClassified(api(`/api/v1/storage/public?objectKey=${encodeURIComponent(missingKey)}`), {
      headers: { accept: 'application/json', origin }
    });
    if (missing.error || !missing.response) {
      push(stepResult('E_MISSING_OBJECT', classifyError(missing.error), {
        attempts: missing.attempts
      }));
      push(stepResult('STREAM_MISSING_RESULT', classifyError(missing.error), {
        attempts: missing.attempts,
        note: 'network/timeout on missing-object probe'
      }));
    } else {
      const code = await missing.response.clone().json().then((b) => b?.error?.code || null).catch(() => null);
      const st = classifyHttpStatus(missing.response.status);
      push(stepResult('E_MISSING_OBJECT', st, {
        httpStatus: missing.response.status,
        code,
        attempts: missing.attempts
      }));
      push(stepResult('STREAM_MISSING_RESULT', st, {
        httpStatus: missing.response.status,
        code
      }));
    }

    const attachIdem = `${idem}-app`;
    const attach = await fetchClassified(api('/api/v1/me/business-applications'), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        origin,
        authorization: `Bearer ${jwt}`,
        'idempotency-key': attachIdem
      },
      body: JSON.stringify({
        complexSlug: fx.complexSlug,
        ...(fx.relationType ? { relationType: fx.relationType } : {}),
        relationRaw: fx.relationRaw,
        businessName: fx.businessName,
        categoryName: fx.categoryName,
        serviceSummary: fx.serviceSummary,
        representativeImageObjectKey: objectKey
      })
    });
    if (attach.error || !attach.response) {
      push(stepResult('G_ATTACH', classifyError(attach.error), {
        attempts: attach.attempts
      }));
    } else {
      const attachBody = await attach.response.json().catch(() => null);
      const attachCode = attachBody?.error?.code || null;
      push(stepResult('G_ATTACH', classifyHttpStatus(attach.response.status), {
        httpStatus: attach.response.status,
        code: attachCode,
        retryAfterMs: parseRetryAfterMs(attach.response),
        attempts: attach.attempts
      }));
      if (attach.response.status === 429) {
        push(stepResult('ATTACH_RATE_LIMIT_RESULT', STATUS.RATE_LIMITED, {
          httpStatus: 429,
          retryAfterMs: parseRetryAfterMs(attach.response),
          note: 'BLOCKED_RATE_LIMIT'
        }));
      }
    }

    if (!attach.error && attach.response && attach.response.status !== 429) {
      const badAttach = await fetchClassified(api('/api/v1/me/business-applications'), {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          origin,
          authorization: `Bearer ${jwt}`,
          'idempotency-key': `${idem}-bad`
        },
        body: JSON.stringify({
          complexSlug: fx.complexSlug,
          relationRaw: fx.relationRaw,
          businessName: fx.businessName,
          categoryName: fx.categoryName,
          serviceSummary: fx.serviceSummary,
          representativeImageObjectKey: 'gdrive/public/business-image/00000000-0000-0000-0000-000000000000'
        })
      });
      if (badAttach.error || !badAttach.response) {
        push(stepResult('H_INVALID_REFERENCE', classifyError(badAttach.error), {
          attempts: badAttach.attempts
        }));
      } else {
        const badBody = await badAttach.response.json().catch(() => null);
        push(stepResult('H_INVALID_REFERENCE', classifyHttpStatus(badAttach.response.status), {
          httpStatus: badAttach.response.status,
          code: badBody?.error?.code || null,
          retryAfterMs: parseRetryAfterMs(badAttach.response),
          attempts: badAttach.attempts
        }));
      }
    } else {
      push(stepResult('H_INVALID_REFERENCE', attach.error || attach.response?.status === 429
        ? (attach.response?.status === 429 ? STATUS.RATE_LIMITED : STATUS.INFRA_FAILURE)
        : STATUS.RATE_LIMITED, {
        note: 'skipped because prior create was rate-limited or failed'
      }));
    }

    const del = await fetchClassified(
      api(`/api/v1/storage/objects?objectKey=${encodeURIComponent(objectKey)}`),
      {
        method: 'DELETE',
        headers: {
          accept: 'application/json',
          origin,
          authorization: `Bearer ${jwt}`
        }
      }
    );
    if (del.error || !del.response) {
      push(stepResult('I_CLEANUP', classifyError(del.error), { attempts: del.attempts }));
    } else {
      push(stepResult('I_CLEANUP', classifyHttpStatus(del.response.status), {
        httpStatus: del.response.status,
        attempts: del.attempts
      }));
    }

    if (!del.error && del.response?.ok) {
      const afterDelete = await fetchClassified(
        api(`/api/v1/storage/public?objectKey=${encodeURIComponent(objectKey)}`),
        { headers: { accept: 'application/json', origin } }
      );
      if (afterDelete.error || !afterDelete.response) {
        push(stepResult('F_DELETED_OBJECT', classifyError(afterDelete.error), {
          attempts: afterDelete.attempts
        }));
        push(stepResult('STREAM_DELETED_RESULT', classifyError(afterDelete.error), {
          attempts: afterDelete.attempts
        }));
      } else {
        const code = await afterDelete.response.clone().json().then((b) => b?.error?.code || null).catch(() => null);
        const st = classifyHttpStatus(afterDelete.response.status);
        push(stepResult('F_DELETED_OBJECT', st, {
          httpStatus: afterDelete.response.status,
          code,
          attempts: afterDelete.attempts
        }));
        push(stepResult('STREAM_DELETED_RESULT', st, {
          httpStatus: afterDelete.response.status,
          code
        }));
      }
    }

    const { counts, overall } = summarizeResults(results);
    console.log(`COUNTS_PASS=${counts.PASS}`);
    console.log(`COUNTS_APPLICATION_FAILURE=${counts.APPLICATION_FAILURE}`);
    console.log(`COUNTS_AUTH_FAILURE=${counts.AUTH_FAILURE}`);
    console.log(`COUNTS_RATE_LIMITED=${counts.RATE_LIMITED}`);
    console.log(`COUNTS_INFRA_FAILURE=${counts.INFRA_FAILURE}`);
    console.log(`COUNTS_HARNESS_FAILURE=${counts.HARNESS_FAILURE}`);
    console.log(`OVERALL_STATUS=${overall}`);
    console.log(`PRODUCTION_MUTATION=0`);
    console.log(`SECRET_OUTPUT=NO`);
    console.log(`TOKEN_OUTPUT=NO`);
    console.log(`COOKIE_OUTPUT=NO`);

    if (overall === STATUS.HARNESS_FAILURE) process.exitCode = 1;
    else process.exitCode = 0;
  } catch (error) {
    const code = error?.harnessCode || 'HARNESS_FAILURE';
    console.error(`HARNESS_ABORT code=${code} message=${redactSecrets(error?.message || '')}`);
    if (code === 'HARNESS_FAILURE' || code === 'REMOTE_ONLY_REQUIRED' || code === 'LOCAL_TARGET_FORBIDDEN'
      || code === 'HTTPS_REQUIRED' || code === 'PRODUCTION_API_TARGET_FORBIDDEN'
      || code === 'PRODUCTION_PAGES_TARGET_FORBIDDEN' || code === 'QA_API_TARGET_INVALID'
      || code === 'QA_PAGES_TARGET_INVALID' || code === 'FIXTURE_INVALID'
      || code === 'MISSING_REQUIRED_QA_INPUT') {
      process.exitCode = 1;
    } else if (code === 'AUTH') {
      process.exitCode = 0;
    } else if (code === 'RATE_LIMITED') {
      process.exitCode = 0;
    } else if (code === 'INFRA' || code === 'EARLY_STOP' || code === 'APP_UPLOAD') {
      process.exitCode = 0;
    } else {
      process.exitCode = 1;
    }
  }
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await main();
}
