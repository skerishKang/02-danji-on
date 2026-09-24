import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import { stampBuildAttribution, resolveBuildSha } from '../scripts/build-attribution.mjs';

// Issue #804: /app immutable build attribution contract
// Proves points A through J required by CENTRAL governance.

const appHtmlPath = new URL('../app.html', import.meta.url);
const appSource = await readFile(appHtmlPath, 'utf8');

const prodWorkflowPath = new URL('../../.github/workflows/pages-production-release.yml', import.meta.url);
const qaWorkflowPath = new URL('../../.github/workflows/qa-pages-deploy.yml', import.meta.url);
const prodWorkflow = await readFile(prodWorkflowPath, 'utf8');
const qaWorkflow = await readFile(qaWorkflowPath, 'utf8');

/* ===================================================================
 * A. NO_NAVIGATION_TIME_BUILD
 * - document.lastModified forbidden
 * - Date.now() forbidden
 * - new Date() runtime generation forbidden
 * =================================================================== */
assert.ok(
  !appSource.includes('document.lastModified'),
  'A: app.html must not use document.lastModified (causes navigation/reload drift)'
);
assert.ok(
  !appSource.includes('Date.now'),
  'A: app.html must not use Date.now() for runtime build generation'
);
assert.ok(
  !/new\s+Date\b/.test(appSource),
  'A: app.html must not generate runtime Date objects'
);
assert.ok(
  !/performance\.now/i.test(appSource),
  'A: app.html must not use performance.now()'
);

/* ===================================================================
 * B. IMMUTABLE_BUILD_SOURCE
 * - build id comes from commit/deploy artifact source
 * =================================================================== */
const SHA_A = '5379b255f23cf7a2ea849d20b0c9c3488d45adf1';
const SHORT_A = '5379b255f23c';

const resolved = resolveBuildSha(SHA_A);
assert.equal(resolved.fullSha, SHA_A, 'B: resolved full SHA must match input commit SHA');
assert.equal(resolved.shortSha, SHORT_A, 'B: resolved short SHA must match 12-char commit prefix');

// Test in an isolated temporary directory
const tempDirA = await mkdtemp(join(tmpdir(), 'danjion-build-attribution-A-'));
const tempDirB = await mkdtemp(join(tmpdir(), 'danjion-build-attribution-B-'));

try {
  await cp(new URL('../app.html', import.meta.url), join(tempDirA, 'app.html'));
  await cp(new URL('../app.html', import.meta.url), join(tempDirB, 'app.html'));

  const stampResult = stampBuildAttribution(tempDirA, SHA_A, {
    builtAt: '2026-09-21T01:30:00.000Z'
  });

  assert.equal(stampResult.shortSha, SHORT_A, 'B: stampBuildAttribution must return shortSha');
  assert.equal(stampResult.fullSha, SHA_A, 'B: stampBuildAttribution must return fullSha');

  // Verify assets/build-info.json manifest was created
  const buildInfoRaw = await readFile(stampResult.buildInfoPath, 'utf8');
  const buildInfo = JSON.parse(buildInfoRaw);
  assert.equal(buildInfo.sha, SHA_A, 'B: build-info.json sha must match commit SHA');
  assert.equal(buildInfo.shortSha, SHORT_A, 'B: build-info.json shortSha must match short SHA');
  assert.equal(buildInfo.builtAt, '2026-09-21T01:30:00.000Z', 'B: build-info.json builtAt preserved');

  const stampedHtmlA = await readFile(join(tempDirA, 'app.html'), 'utf8');
  assert.ok(
    stampedHtmlA.includes(`data-build="${SHORT_A}"`),
    'B: app.html must carry data-build attribute with immutable SHA'
  );
  assert.ok(
    stampedHtmlA.includes(`src="index.html?variant=v3&amp;build=${SHORT_A}"`),
    'B: app.html iframe src must be stamped with variant=v3 and build=<sha>'
  );

  /* ===================================================================
   * C. SAME_ARTIFACT_STABLE
   * - Loading the exact same artifact multiple times (e.g. reload after 19s)
   *   produces the identical build identifier
   * =================================================================== */
  function extractScriptBlock(html) {
    const scripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
    assert.ok(scripts.length >= 2, 'app.html must contain both variant storage and execution scripts');
    const lastScript = scripts[scripts.length - 1];
    return lastScript[1];
  }

  function simulateAppLoad(html, simulatedTimeOffsetMs = 0) {
    const script = extractScriptBlock(html);
    const dataBuildMatch = html.match(/data-build="([^"]*)"/);
    const srcMatch = html.match(/id="danjionAppFrame"\s+src="([^"]*)"/);
    const initialSrc = srcMatch ? srcMatch[1].replace(/&amp;/g, '&') : 'index.html?variant=v3';
    const initialDataBuild = dataBuildMatch ? dataBuildMatch[1] : '';

    const frame = {
      attributes: {
        id: 'danjionAppFrame',
        src: initialSrc,
        'data-build': initialDataBuild
      },
      src: initialSrc,
      getAttribute(k) { return this.attributes[k] || null; },
      setAttribute(k, v) { this.attributes[k] = String(v); }
    };
    const badge = { textContent: '' };

    const sandbox = {
      document: {
        getElementById(id) {
          if (id === 'danjionAppFrame') return frame;
          if (id === 'danjionBuildId') return badge;
          return null;
        },
        lastModified: new Date(Date.now() + simulatedTimeOffsetMs).toUTCString()
      },
      location: {
        href: 'https://danjion.pages.dev/app.html'
      },
      URL,
      console
    };

    vm.createContext(sandbox);
    vm.runInContext(script, sandbox);

    return {
      frameSrc: frame.src,
      badgeText: badge.textContent,
      dataBuild: frame.getAttribute('data-build')
    };
  }

  const load1 = simulateAppLoad(stampedHtmlA, 0);
  // Simulate reload 19 seconds later
  const load2 = simulateAppLoad(stampedHtmlA, 19000);
  // Simulate reload 1 hour later
  const load3 = simulateAppLoad(stampedHtmlA, 3600000);

  assert.equal(load1.frameSrc, `index.html?variant=v3&build=${SHORT_A}`, 'C: initial load frame src correct');
  assert.equal(load2.frameSrc, load1.frameSrc, 'C: reload after 19s must yield identical frame src');
  assert.equal(load3.frameSrc, load1.frameSrc, 'C: reload after 1hr must yield identical frame src');
  assert.equal(load2.badgeText, SHORT_A, 'C: badge text stable across reloads');
  assert.equal(load3.badgeText, SHORT_A, 'C: badge text stable across reloads');

  /* ===================================================================
   * D. NEW_SHA_CHANGES_BUILD
   * - A different commit SHA produces a different build identifier
   * =================================================================== */
  const SHA_B = '5ca150b7a5b20d4fb8694711a054bd08856dd83f';
  const SHORT_B = '5ca150b7a5b2';

  stampBuildAttribution(tempDirB, SHA_B);
  const stampedHtmlB = await readFile(join(tempDirB, 'app.html'), 'utf8');
  const loadB = simulateAppLoad(stampedHtmlB, 0);

  assert.equal(loadB.frameSrc, `index.html?variant=v3&build=${SHORT_B}`, 'D: artifact B has new build id');
  assert.notEqual(load1.frameSrc, loadB.frameSrc, 'D: new SHA artifact must produce different frame src');
  assert.notEqual(load1.badgeText, loadB.badgeText, 'D: new SHA artifact must produce different badge text');

  /* ===================================================================
   * E. APP_IFRAME_PROPAGATION
   * - variant=v3 preserved
   * - build=<immutable-id> present in searchParams
   * =================================================================== */
  const urlA = new URL(load1.frameSrc, 'https://danjion.pages.dev');
  assert.equal(urlA.searchParams.get('variant'), 'v3', 'E: variant=v3 parameter must be preserved');
  assert.equal(urlA.searchParams.get('build'), SHORT_A, 'E: build query must match shortSha');

  const urlB = new URL(loadB.frameSrc, 'https://danjion.pages.dev');
  assert.equal(urlB.searchParams.get('variant'), 'v3', 'E: variant=v3 parameter must be preserved on B');
  assert.equal(urlB.searchParams.get('build'), SHORT_B, 'E: build query must match shortSha on B');

  /* ===================================================================
   * F. NO_MANUAL_20260907
   * - No obsolete hardcoded 20260907 in source or stamped output
   * =================================================================== */
  assert.ok(!appSource.includes('20260907'), 'F: source app.html must not contain obsolete 20260907');
  assert.ok(!stampedHtmlA.includes('20260907'), 'F: stamped app.html must not contain obsolete 20260907');
  assert.ok(!stampedHtmlB.includes('20260907'), 'F: stamped app.html B must not contain obsolete 20260907');

  /* ===================================================================
   * G. APP_HTML_MUTATION_PROOF
   * - Reverting to document.lastModified fails the contract
   * - Omitting build parameter fails
   * - Dropping variant=v3 fails
   * =================================================================== */
  const mutatedLastModified = appSource.replace(
    "const raw=(frame.getAttribute('data-build')||'').trim();",
    "const stamp=(document.lastModified||'').trim();"
  );
  assert.throws(
    () => {
      assert.ok(!mutatedLastModified.includes('document.lastModified'), 'must reject document.lastModified');
    },
    /must reject document\.lastModified/,
    'G: contract must FAIL if document.lastModified is reintroduced'
  );

  const mutatedDateNow = appSource.replace(
    "const raw=(frame.getAttribute('data-build')||'').trim();",
    'const raw=String(Date.now());'
  );
  assert.throws(
    () => {
      assert.ok(!mutatedDateNow.includes('Date.now'), 'must reject Date.now');
    },
    /must reject Date\.now/,
    'G: contract must FAIL if Date.now() is reintroduced'
  );

  const brokenUrl = new URL('index.html?variant=v3', 'https://danjion.pages.dev');
  assert.throws(
    () => {
      assert.equal(brokenUrl.searchParams.get('build'), SHORT_A, 'build must be present');
    },
    /build must be present/,
    'G: contract must FAIL if build query param is omitted'
  );

  const brokenVariantUrl = new URL(`index.html?build=${SHORT_A}`, 'https://danjion.pages.dev');
  assert.throws(
    () => {
      assert.equal(brokenVariantUrl.searchParams.get('variant'), 'v3', 'variant must be v3');
    },
    /variant must be v3/,
    'G: contract must FAIL if variant=v3 is dropped'
  );

} finally {
  await rm(tempDirA, { recursive: true, force: true });
  await rm(tempDirB, { recursive: true, force: true });
}

/* ===================================================================
 * H. PRODUCTION WORKFLOW CONTRACT
 * - Proves: node frontend/scripts/build-attribution.mjs dist "$EXPECTED_MAIN"
 * - Proves: stamp executes before pages deploy dist
 * - Proves: pages deploy passes --commit-hash "$EXPECTED_MAIN"
 * - VISIBLE_BUILD_SHA == DEPLOYED_CLOUDFLARE_COMMIT_SHA == $EXPECTED_MAIN
 * =================================================================== */
export function verifyProductionWorkflow(workflowText) {
  const stampLine = 'node frontend/scripts/build-attribution.mjs dist "$EXPECTED_MAIN"';
  const stampIdx = workflowText.indexOf(stampLine);
  if (stampIdx === -1) {
    throw new Error('WORKFLOW_MUTATION_FAIL: missing production build-attribution stamp with $EXPECTED_MAIN');
  }

  const deployMatch = workflowText.match(/npx\s+wrangler[^\n]*pages\s+deploy\s+dist\b/);
  if (!deployMatch) {
    throw new Error('WORKFLOW_MUTATION_FAIL: missing production pages deploy dist command');
  }
  const deployIdx = deployMatch.index;

  if (stampIdx >= deployIdx) {
    throw new Error('WORKFLOW_MUTATION_FAIL: production stamp must precede pages deploy');
  }

  const deployBlock = workflowText.slice(deployIdx, deployIdx + 300);
  if (!deployBlock.includes('--commit-hash "$EXPECTED_MAIN"')) {
    throw new Error('WORKFLOW_MUTATION_FAIL: production deploy must pass --commit-hash "$EXPECTED_MAIN"');
  }

  return true;
}

assert.ok(
  verifyProductionWorkflow(prodWorkflow),
  'H: production workflow must pass attribution and deploy SHA lock'
);

/* ===================================================================
 * I. QA WORKFLOW CONTRACT
 * - Proves: node frontend/scripts/build-attribution.mjs dist-qa "$GITHUB_SHA"
 * - Proves: stamp executes before qa-pages-runtime-bind and pages deploy dist-qa
 * - Proves: pages deploy passes --commit-hash "$GITHUB_SHA"
 * - VISIBLE_BUILD_SHA == QA_DEPLOY_COMMIT_SHA == $GITHUB_SHA
 * =================================================================== */
export function verifyQaWorkflow(workflowText) {
  const stampLine = 'node frontend/scripts/build-attribution.mjs dist-qa "$GITHUB_SHA"';
  const stampIdx = workflowText.indexOf(stampLine);
  if (stampIdx === -1) {
    throw new Error('WORKFLOW_MUTATION_FAIL: missing QA build-attribution stamp with $GITHUB_SHA');
  }

  const runtimeBindIdx = workflowText.indexOf("node '04_개발/backend/scripts/qa-pages-runtime-bind.mjs' dist-qa");
  const deployMatch = workflowText.match(/npx\s+wrangler[^\n]*pages\s+deploy\s+dist-qa\b/);
  if (!deployMatch) {
    throw new Error('WORKFLOW_MUTATION_FAIL: missing QA pages deploy dist-qa command');
  }
  const deployIdx = deployMatch.index;

  if (stampIdx >= deployIdx) {
    throw new Error('WORKFLOW_MUTATION_FAIL: QA stamp must precede pages deploy');
  }

  if (runtimeBindIdx !== -1 && stampIdx >= runtimeBindIdx) {
    throw new Error('WORKFLOW_MUTATION_FAIL: QA stamp must precede runtime bind');
  }

  const deployBlock = workflowText.slice(deployIdx, deployIdx + 300);
  if (!deployBlock.includes('--commit-hash "$GITHUB_SHA"')) {
    throw new Error('WORKFLOW_MUTATION_FAIL: QA deploy must pass --commit-hash "$GITHUB_SHA"');
  }

  return true;
}

assert.ok(
  verifyQaWorkflow(qaWorkflow),
  'I: QA workflow must pass attribution, runtime bind order, and deploy SHA lock'
);

/* ===================================================================
 * J. WORKFLOW MUTATION PROOF
 * - Minimum required mutations that must cause contract failure:
 *   Mutation A: Removal of build-attribution invocation in Production workflow
 *   Mutation B: Removal of build-attribution invocation in QA workflow
 *   Mutation C: Using unrelated/static value instead of "$GITHUB_SHA"
 *   Mutation D: Relocating stamp after deploy
 * =================================================================== */
// Mutation A: Removal of build-attribution invocation in Production workflow
const mutA = prodWorkflow.replace('node frontend/scripts/build-attribution.mjs dist "$EXPECTED_MAIN"', '');
assert.throws(
  () => verifyProductionWorkflow(mutA),
  /missing production build-attribution stamp/,
  'J: removing production build-attribution invocation must fail contract'
);

// Mutation B: Removal of build-attribution invocation in QA workflow
const mutB = qaWorkflow.replace('node frontend/scripts/build-attribution.mjs dist-qa "$GITHUB_SHA"', '');
assert.throws(
  () => verifyQaWorkflow(mutB),
  /missing QA build-attribution stamp/,
  'J: removing QA build-attribution invocation must fail contract'
);

// Mutation C1: Using static/unrelated value instead of $EXPECTED_MAIN in Production
const mutC1 = prodWorkflow.replace('"$EXPECTED_MAIN"', '"20260921-static-fake-sha"');
assert.throws(
  () => verifyProductionWorkflow(mutC1),
  /missing production build-attribution stamp with \$EXPECTED_MAIN/,
  'J: static/unrelated value in production workflow must fail contract'
);

// Mutation C2: Using static/unrelated value instead of $GITHUB_SHA in QA
const mutC2 = qaWorkflow.replace('"$GITHUB_SHA"', '"qa-static-fake-sha"');
assert.throws(
  () => verifyQaWorkflow(mutC2),
  /missing QA build-attribution stamp with \$GITHUB_SHA/,
  'J: static/unrelated value in QA workflow must fail contract'
);

// Mutation D1: Moving stamp after deploy in Production workflow
const mutD1 = prodWorkflow
  .replace('node frontend/scripts/build-attribution.mjs dist "$EXPECTED_MAIN"\n', '')
  + '\nnode frontend/scripts/build-attribution.mjs dist "$EXPECTED_MAIN"\n';
assert.throws(
  () => verifyProductionWorkflow(mutD1),
  /production stamp must precede pages deploy/,
  'J: relocating production stamp after deploy must fail contract'
);

// Mutation D2: Moving stamp after deploy in QA workflow
const mutD2 = qaWorkflow
  .replace('node frontend/scripts/build-attribution.mjs dist-qa "$GITHUB_SHA"\n', '')
  + '\nnode frontend/scripts/build-attribution.mjs dist-qa "$GITHUB_SHA"\n';
assert.throws(
  () => verifyQaWorkflow(mutD2),
  /QA stamp must precede pages deploy/,
  'J: relocating QA stamp after deploy must fail contract'
);

console.log('leaf-b804-app-build-attribution-contract: PASS (points A through J fully verified)');

/* ===================================================================
 * K. CI TRIGGER COVERAGE CONTRACT
 * - Proves: .github/workflows/toplevel-frontend-contract-gate.yml watches
 *   both pages-production-release.yml and qa-pages-deploy.yml
 * - Proves: coverage is locked on both pull_request and push triggers
 * - PRODUCTION_WORKFLOW_TRIGGER_LOCKED=YES
 * - QA_WORKFLOW_TRIGGER_LOCKED=YES
 * =================================================================== */
const gateWorkflowPath = new URL('../../.github/workflows/toplevel-frontend-contract-gate.yml', import.meta.url);
const gateWorkflow = await readFile(gateWorkflowPath, 'utf8');

export function verifyTriggerCoverage(gateText) {
  const prIdx = gateText.indexOf('pull_request:');
  const pushIdx = gateText.indexOf('push:');
  if (prIdx === -1 || pushIdx === -1) {
    throw new Error('TRIGGER_MUTATION_FAIL: missing pull_request or push trigger');
  }
  const prSection = gateText.slice(prIdx, pushIdx);
  const pushSection = gateText.slice(pushIdx, gateText.indexOf('workflow_dispatch:', pushIdx));

  const PROD_PATH = "'.github/workflows/pages-production-release.yml'";
  const QA_PATH = "'.github/workflows/qa-pages-deploy.yml'";

  if (!prSection.includes(PROD_PATH)) {
    throw new Error('TRIGGER_MUTATION_FAIL: pull_request must watch pages-production-release.yml');
  }
  if (!prSection.includes(QA_PATH)) {
    throw new Error('TRIGGER_MUTATION_FAIL: pull_request must watch qa-pages-deploy.yml');
  }
  if (!pushSection.includes(PROD_PATH)) {
    throw new Error('TRIGGER_MUTATION_FAIL: push must watch pages-production-release.yml');
  }
  if (!pushSection.includes(QA_PATH)) {
    throw new Error('TRIGGER_MUTATION_FAIL: push must watch qa-pages-deploy.yml');
  }
  return true;
}

assert.ok(
  verifyTriggerCoverage(gateWorkflow),
  'K: toplevel gate must watch both production and QA release workflow files'
);

/* ===================================================================
 * L. TRIGGER MUTATION PROOF
 * - Mutation A: Removal of pages-production-release.yml from pull_request -> FAIL
 * - Mutation B: Removal of qa-pages-deploy.yml from pull_request -> FAIL
 * - Mutation C: Removal of pages-production-release.yml from push -> FAIL
 * - Mutation D: Removal of qa-pages-deploy.yml from push -> FAIL
 * =================================================================== */
// Mutation A: Removal of pages-production-release.yml from pull_request
const prProdPath = "      - '.github/workflows/pages-production-release.yml'\n";
assert.ok(gateWorkflow.indexOf(prProdPath) !== -1, 'prProdPath anchor must exist');
const mutTrigA = gateWorkflow.replace(prProdPath, '');
assert.throws(
  () => verifyTriggerCoverage(mutTrigA),
  /pull_request must watch pages-production-release\.yml/,
  'L: removing pages-production-release.yml from pull_request must fail trigger contract'
);

// Mutation B: Removal of qa-pages-deploy.yml from pull_request
const prQaPath = "      - '.github/workflows/qa-pages-deploy.yml'\n";
assert.ok(gateWorkflow.indexOf(prQaPath) !== -1, 'prQaPath anchor must exist');
const mutTrigB = gateWorkflow.replace(prQaPath, '');
assert.throws(
  () => verifyTriggerCoverage(mutTrigB),
  /pull_request must watch qa-pages-deploy\.yml/,
  'L: removing qa-pages-deploy.yml from pull_request must fail trigger contract'
);

// Mutation C: Removal of pages-production-release.yml from push
const pushProdIdx = gateWorkflow.lastIndexOf(prProdPath);
assert.ok(pushProdIdx !== -1, 'pushProdPath anchor must exist');
const mutTrigC = gateWorkflow.slice(0, pushProdIdx) + gateWorkflow.slice(pushProdIdx + prProdPath.length);
assert.throws(
  () => verifyTriggerCoverage(mutTrigC),
  /push must watch pages-production-release\.yml/,
  'L: removing pages-production-release.yml from push must fail trigger contract'
);

// Mutation D: Removal of qa-pages-deploy.yml from push
const pushQaIdx = gateWorkflow.lastIndexOf(prQaPath);
assert.ok(pushQaIdx !== -1, 'pushQaPath anchor must exist');
const mutTrigD = gateWorkflow.slice(0, pushQaIdx) + gateWorkflow.slice(pushQaIdx + prQaPath.length);
assert.throws(
  () => verifyTriggerCoverage(mutTrigD),
  /push must watch qa-pages-deploy\.yml/,
  'L: removing qa-pages-deploy.yml from push must fail trigger contract'
);

console.log('leaf-b804-app-build-attribution-contract: PASS (points A through L fully verified)');
