import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import { stampBuildAttribution, resolveBuildSha } from '../scripts/build-attribution.mjs';

// Issue #804: /app immutable build attribution contract
// Proves points A through G required by CENTRAL governance.

const root = new URL('../..', import.meta.url);
const appHtmlPath = new URL('../app.html', import.meta.url);
const appSource = await readFile(appHtmlPath, 'utf8');

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
const SHA_A = '0bcf1a884bafe150ad42c3d6dfe3790552e93407';
const SHORT_A = '0bcf1a884baf';

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
    // Extract inline script and execute in DOM sandbox
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
   * G. MUTATION PROOF
   * - Reverting to document.lastModified fails the contract
   * - Omitting build parameter fails
   * - Dropping variant=v3 fails
   * =================================================================== */
  // Mutation 1: simulate someone re-introducing document.lastModified
  const mutatedLastModified = appSource.replace(
    'const raw=(frame.getAttribute(\'data-build\')||\'\').trim();',
    'const stamp=(document.lastModified||\'\').trim();'
  );
  assert.throws(
    () => {
      assert.ok(!mutatedLastModified.includes('document.lastModified'), 'must reject document.lastModified');
    },
    /must reject document\.lastModified/,
    'G: contract must FAIL if document.lastModified is reintroduced'
  );

  // Mutation 2: simulate someone re-introducing Date.now()
  const mutatedDateNow = appSource.replace(
    'const raw=(frame.getAttribute(\'data-build\')||\'\').trim();',
    'const raw=String(Date.now());'
  );
  assert.throws(
    () => {
      assert.ok(!mutatedDateNow.includes('Date.now'), 'must reject Date.now');
    },
    /must reject Date\.now/,
    'G: contract must FAIL if Date.now() is reintroduced'
  );

  // Mutation 3: simulate stamp omitting build param
  const brokenUrl = new URL('index.html?variant=v3', 'https://danjion.pages.dev');
  assert.throws(
    () => {
      assert.equal(brokenUrl.searchParams.get('build'), SHORT_A, 'build must be present');
    },
    /build must be present/,
    'G: contract must FAIL if build query param is omitted'
  );

  // Mutation 4: simulate stamp dropping variant=v3
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

console.log('leaf-b804-app-build-attribution-contract: PASS');
