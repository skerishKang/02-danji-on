// DanjiOn availability monitor (runbook §10.2 / OPS_RELIABILITY_RUNBOOK_v1).
// Read-only: performs GET /api/health + GET / against pinned, allow-listed
// origins. Mutates nothing. Prints only host labels + PASS/FAIL and bounded
// status codes; never prints cookies, tokens, response bodies beyond the
// bounded health summary, or any credential material.

const TARGETS = Object.freeze([
  { label: 'PROD_WORKER_HEALTH', url: 'https://padiem-danjion-api-production.padiem.workers.dev/api/health', expectStatus: 200, expectDatabaseOk: true },
  { label: 'PROD_PAGES_ROOT', url: 'https://danjion.pages.dev/', expectStatus: 200 },
  { label: 'QA_WORKER_HEALTH', url: 'https://padiem-danjion-api-qa.padiem.workers.dev/api/health', expectStatus: 200, expectDatabaseOk: true }
]);

const ALLOWED_SUFFIX = '.padiem.workers.dev';
const ALLOWED_PAGES = 'danjion.pages.dev';
const TIMEOUT_MS = 15_000;

function assertAllowedOrigin(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new Error(`MONITOR_ORIGIN_NOT_HTTPS:${url.hostname}`);
  const isWorker = url.hostname.endsWith(ALLOWED_SUFFIX);
  const isPages = url.hostname === ALLOWED_PAGES;
  if (!isWorker && !isPages) throw new Error(`MONITOR_ORIGIN_NOT_ALLOW_LISTED:${url.hostname}`);
  return url;
}

async function check(target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    assertAllowedOrigin(target.url);
    const response = await fetch(target.url, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      signal: controller.signal,
      headers: { accept: 'application/json, text/html;q=0.8' }
    });
    const statusOk = response.status === target.expectStatus;
    let databaseOk = true;
    if (target.expectDatabaseOk) {
      const body = await response.json().catch(() => null);
      databaseOk = body?.data?.status === 'ok' && body?.data?.database === 'ok';
    }
    const pass = statusOk && databaseOk;
    console.log(`${target.label}=${pass ? 'PASS' : `FAIL_HTTP_${response.status}${databaseOk ? '' : '_DB_NOT_OK'}`}`);
    return pass;
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'TIMEOUT' : 'REQUEST_ERROR';
    console.log(`${target.label}=FAIL_${reason}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const results = [];
for (const target of TARGETS) {
  // one bounded retry for transient network noise; not for hard failures
  const first = await check(target);
  if (first) {
    results.push(true);
    continue;
  }
  console.log(`${target.label}=RETRY_ONCE`);
  results.push(await check(target));
}

const failed = results.filter((pass) => !pass).length;
console.log(`TARGETS_TOTAL=${TARGETS.length}`);
console.log(`TARGETS_FAILED=${failed}`);
console.log('PRODUCTION_MUTATION=NO');
console.log('SECRET_OUTPUT=NO');
if (failed > 0) process.exitCode = 1;
