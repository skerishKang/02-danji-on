import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PRODUCTION_API_HOST = 'padiem-danjion-api-production.padiem.workers.dev';
const QA_PAGES_HOST = 'danjion-qa.pages.dev';
const QA_WORKER_PREFIX = 'padiem-danjion-api-qa.';

function fail(message) {
  throw new Error(`QA_PAGES_RUNTIME_BIND_FAILED:${message}`);
}

export function validateQaApi(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); } catch { fail('INVALID_QA_API_URL'); }
  if (url.protocol !== 'https:') fail('QA_API_MUST_USE_HTTPS');
  const host = url.hostname.toLowerCase();
  if (host === PRODUCTION_API_HOST) fail('PRODUCTION_API_FORBIDDEN');
  if (!host.startsWith(QA_WORKER_PREFIX) || !host.endsWith('.workers.dev')) fail('QA_WORKER_HOST_REQUIRED');
  if (url.pathname !== '/' || url.search || url.hash) fail('QA_API_ORIGIN_ONLY');
  return url.origin;
}

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) fail(`ANCHOR_MISSING:${label}`);
  if (source.indexOf(needle, first + needle.length) >= 0) fail(`ANCHOR_AMBIGUOUS:${label}`);
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

export function bindQaPagesRuntime(source, qaApiOrigin) {
  let next = source;

  const constantsAnchor = "  const PRODUCTION_API_BASE = 'https://padiem-danjion-api-production.padiem.workers.dev';";
  next = replaceOnce(
    next,
    constantsAnchor,
    `${constantsAnchor}\n  // QA-only deployment artifact binding (#686). The QA Pages facade is same-origin;\n  // its Pages Function selects the fixed QA Worker upstream server-side.\n  const QA_PAGES_HOSTNAME = '${QA_PAGES_HOST}';\n  const QA_PAGES_API_BASE = 'https://${QA_PAGES_HOST}';`,
    'constants'
  );

  const apiAnchor = '    if (hostname === PRODUCTION_PAGES_HOSTNAME) return CANONICAL_PAGES_API_BASE;';
  next = replaceOnce(
    next,
    apiAnchor,
    `${apiAnchor}\n    if (hostname === QA_PAGES_HOSTNAME) return QA_PAGES_API_BASE;`,
    'api-base'
  );

  const authAnchor = "    if (hostname === PRODUCTION_PAGES_HOSTNAME) return '';";
  next = replaceOnce(
    next,
    authAnchor,
    `${authAnchor}\n    if (hostname === QA_PAGES_HOSTNAME) return '';`,
    'auth-base'
  );

  if (!next.includes(`const QA_PAGES_HOSTNAME = '${QA_PAGES_HOST}'`)) fail('QA_HOST_BINDING_MISSING');
  if (!next.includes(`const QA_PAGES_API_BASE = 'https://${QA_PAGES_HOST}'`)) fail('QA_API_BASE_BINDING_MISSING');
  return next;
}

async function main() {
  const dist = process.argv[2];
  if (!dist) fail('DIST_PATH_REQUIRED');
  const qaApiOrigin = validateQaApi(process.env.DANJION_QA_API_URL);
  const runtimePath = resolve(dist, 'assets', 'danjion-session.js');
  const source = await readFile(runtimePath, 'utf8');
  const bound = bindQaPagesRuntime(source, qaApiOrigin);
  await writeFile(runtimePath, bound, 'utf8');
  console.log('QA Pages runtime binding: PASS (origin value suppressed)');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
