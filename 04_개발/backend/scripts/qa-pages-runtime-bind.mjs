import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PRODUCTION_API_HOST = 'padiem-danjion-api-production.padiem.workers.dev';
const QA_PAGES_HOST = 'danjion-qa.pages.dev';
const QA_WORKER_PREFIX = 'padiem-danjion-api-qa.';

// --- Current DanjionSession resolver anchors (#830 same-origin architecture) ---------------
// The pre-#830 runtime exposed `PRODUCTION_API_BASE` / `CANONICAL_PAGES_API_BASE` and the
// resolver returned an absolute base for the production host. Since the same-origin cutover
// the canonical hosts return '' and the fixed Worker upstream lives only in the server-side
// Pages Functions. The anchors below target the CURRENT structure and are validated for
// uniqueness so a stale or drifted runtime fails closed instead of being force-patched.
const PRODUCTION_PAGES_CONST = "  const PRODUCTION_PAGES_HOSTNAME = 'danjion.pages.dev';";
const PRODUCTION_PAGES_BRANCH = "    if (hostname === PRODUCTION_PAGES_HOSTNAME) return '';";
const API_FUNCTION_DECL = 'function danjionApiBase(loc) {';
const AUTH_FUNCTION_DECL = 'function danjionAuthBase(loc) {';
// Top-level (2-space indent) function declarations delimit the resolver function regions.
const FUNCTION_START = /\n  (?:async )?function [A-Za-z_$][\w$]*\s*\(/g;

const QA_CONSTANTS_BLOCK = [
  PRODUCTION_PAGES_CONST,
  '  // QA-only deployment artifact binding (#686/#830). `danjion-qa.pages.dev` is a',
  '  // same-origin QA Pages facade; its Pages Function selects the fixed QA Worker',
  '  // upstream server-side, so no Worker URL is ever embedded in the browser runtime.',
  `  const QA_PAGES_HOSTNAME = '${QA_PAGES_HOST}';`,
  `  const QA_PAGES_API_BASE = 'https://${QA_PAGES_HOST}';`,
].join('\n');

const QA_API_BRANCH = [
  PRODUCTION_PAGES_BRANCH,
  '    // QA-only same-origin facade binding. Placed before the controlled-preview',
  '    // ?apiBase= branch so a crafted query can never move QA application API traffic.',
  '    if (hostname === QA_PAGES_HOSTNAME) return QA_PAGES_API_BASE;',
].join('\n');

const QA_AUTH_BRANCH = [
  PRODUCTION_PAGES_BRANCH,
  '    // QA-only same-origin facade binding (relative, never absolute).',
  "    if (hostname === QA_PAGES_HOSTNAME) return '';",
].join('\n');

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

function countOccurrences(haystack, needle) {
  let count = 0;
  let at = 0;
  while ((at = haystack.indexOf(needle, at)) >= 0) {
    count += 1;
    at += needle.length;
  }
  return count;
}

// Exactly-one replacement. 0 matches => stale source, 2+ => ambiguous anchor: both fail closed.
function replaceExactlyOnce(source, needle, replacement, label) {
  const count = countOccurrences(source, needle);
  if (count === 0) fail(`ANCHOR_MISSING:${label}`);
  if (count > 1) fail(`ANCHOR_AMBIGUOUS:${label}`);
  const at = source.indexOf(needle);
  return source.slice(0, at) + replacement + source.slice(at + needle.length);
}

// Slice exactly one function region, bounded by the next top-level function declaration.
// This keeps the generic production-pages branch unambiguous across danjionApiBase/danjionAuthBase.
function functionRegion(source, declaration, label) {
  const count = countOccurrences(source, declaration);
  if (count === 0) fail(`ANCHOR_MISSING:${label}`);
  if (count > 1) fail(`ANCHOR_AMBIGUOUS:${label}`);
  const start = source.indexOf(declaration);
  FUNCTION_START.lastIndex = start + declaration.length;
  const next = FUNCTION_START.exec(source);
  const end = next ? next.index : source.length;
  const body = source.slice(start, end);
  if (!body.includes(PRODUCTION_PAGES_BRANCH)) fail(`PRODUCTION_PAGES_BRANCH_MISSING:${label}`);
  return { start, end, body };
}

/**
 * Bind the QA Pages runtime into a copy of the canonical `frontend/assets/danjion-session.js`.
 *
 * Inserted into the QA artifact only:
 *   const QA_PAGES_HOSTNAME = 'danjion-qa.pages.dev';
 *   const QA_PAGES_API_BASE = 'https://danjion-qa.pages.dev';
 *
 * Resolver outcome on the QA host: danjionApiBase() === 'https://danjion-qa.pages.dev',
 * danjionAuthBase() === ''. Canonical Production semantics are preserved untouched, and no
 * fixed Production Worker URL is ever embedded in the browser artifact.
 */
export function bindQaPagesRuntime(source, qaApiOrigin) {
  // Fail closed on any origin that is not the dedicated QA Worker boundary.
  validateQaApi(qaApiOrigin);

  let next = replaceExactlyOnce(source, PRODUCTION_PAGES_CONST, QA_CONSTANTS_BLOCK, 'constants');

  const api = functionRegion(next, API_FUNCTION_DECL, 'api-function');
  const apiBound = replaceExactlyOnce(api.body, PRODUCTION_PAGES_BRANCH, QA_API_BRANCH, 'api-base');
  next = next.slice(0, api.start) + apiBound + next.slice(api.end);

  const auth = functionRegion(next, AUTH_FUNCTION_DECL, 'auth-function');
  const authBound = replaceExactlyOnce(auth.body, PRODUCTION_PAGES_BRANCH, QA_AUTH_BRANCH, 'auth-base');
  next = next.slice(0, auth.start) + authBound + next.slice(auth.end);

  if (!next.includes(`const QA_PAGES_HOSTNAME = '${QA_PAGES_HOST}'`)) fail('QA_HOST_BINDING_MISSING');
  if (!next.includes(`const QA_PAGES_API_BASE = 'https://${QA_PAGES_HOST}'`)) fail('QA_API_BASE_BINDING_MISSING');
  if (!next.includes('if (hostname === QA_PAGES_HOSTNAME) return QA_PAGES_API_BASE;')) fail('QA_API_BRANCH_MISSING');
  if (!next.includes("if (hostname === QA_PAGES_HOSTNAME) return '';")) fail('QA_AUTH_BRANCH_MISSING');
  if (next.includes(PRODUCTION_API_HOST)) fail('DIRECT_PRODUCTION_WORKER_BROWSER_BINDING');
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
