/**
 * Issue #835 — Frontend CI must trigger on top-level `frontend/**` changes.
 *
 * The real product surface of DanjiOn is the repository-top-level `frontend/**`
 * tree, but `.github/workflows/frontend-ci.yml` only watched
 * `04_개발/frontend/**`. A PR that changed only top-level frontend leaves
 * therefore never ran Frontend CI at all — a pure trigger-coverage gap (the
 * Toplevel Frontend Contract Gate and the Canonical V3 Browser Gate are
 * separate safety nets, not a substitute for the Frontend CI job itself).
 *
 * This contract pins the accepted trigger surface so the gap cannot silently
 * come back, and so an overly broad `**` trigger cannot be introduced either.
 * It is a declarations-only check: it never runs a workflow and never touches
 * production.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const WORKFLOW_URL = new URL('../../.github/workflows/frontend-ci.yml', import.meta.url);
const workflow = await readFile(WORKFLOW_URL, 'utf8');

/* ---------------------------------------------------------------- *
 * A deliberately tiny reader for the two path lists we care about.
 * A full YAML parser is not a dependency of this repo's test set, so we
 * locate `paths:` under each event and collect the quoted list items that
 * follow it, stopping at the next non-list line.
 * ---------------------------------------------------------------- */
function extractPaths(source, eventName) {
  const lines = source.split(/\r?\n/);
  const eventAt = lines.findIndex((l) => new RegExp(`^\\s{2}${eventName}:\\s*$`).test(l));
  assert.ok(eventAt > -1, `workflow must declare a top-level "${eventName}:" trigger`);

  const pathsAt = lines.findIndex((l, i) => i > eventAt && /^\s{4}paths:\s*$/.test(l));
  assert.ok(pathsAt > -1, `"${eventName}" trigger must declare a "paths:" filter`);

  const collected = [];
  for (let i = pathsAt + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s{4}\S/.test(line)) break; // next key at the event level -> list ended
    const m = line.match(/^\s*-\s*'([^']+)'\s*$/);
    if (m) collected.push(m[1]);
    else if (line.trim() !== '') break;
  }
  return collected;
}

for (const event of ['pull_request', 'push']) {
  const paths = extractPaths(workflow, event);

  // 1. The gap that Issue #835 reports must stay closed.
  assert.ok(
    paths.includes('frontend/**'),
    `${event}: top-level "frontend/**" must be in the path filter (Issue #835)`,
  );

  // 2. Existing 04_개발-scoped coverage must be preserved.
  assert.ok(
    paths.includes('04_개발/frontend/**'),
    `${event}: pre-existing "04_개발/frontend/**" coverage must be preserved`,
  );

  // 3. Self-trigger on workflow edits.
  assert.ok(
    paths.includes('.github/workflows/frontend-ci.yml'),
    `${event}: the workflow file itself must trigger a re-run`,
  );

  // 4. No blanket trigger: a bare `**` would fire Frontend CI on every
  //    backend/docs-only PR, which is exactly what must not happen.
  assert.ok(
    !paths.includes('**') && !paths.includes('*'),
    `${event}: path filter must not be a blanket '**' trigger, got ${JSON.stringify(paths)}`,
  );

  // 5. Unrelated scopes must stay untriggered.
  for (const forbidden of [
    '04_개발/backend/**',
    'functions/**',
    'docs/**',
    'frontend/**/*.html',
  ]) {
    assert.ok(
      !paths.includes(forbidden),
      `${event}: unrelated path "${forbidden}" must not be added to Frontend CI triggers`,
    );
  }

  // 6. The list must stay minimal — a growing trigger surface should be a
  //    deliberate, reviewed change rather than accidental drift.
  assert.ok(
    paths.length <= 4,
    `${event}: Frontend CI path filter should stay minimal, got ${paths.length}: ${JSON.stringify(paths)}`,
  );
}

// The fix is a trigger-only change: the job body must remain untouched and
// must not have gained production authority along the way.
assert.match(workflow, /^\s{2}frontend-check:\s*$/m, 'frontend-check job must remain');
assert.match(workflow, /working-directory: 04_개발\/frontend/, 'job must keep targeting 04_개발/frontend');
assert.doesNotMatch(
  workflow,
  /secrets\.|workflow_dispatch|CLOUDFLARE_API_TOKEN|DATABASE_URL/,
  'Frontend CI must not gain secrets or a manual dispatch surface in this fix',
);

process.stdout.write(
  'leaf-b835-frontend-ci-trigger-coverage-contract: PASS '
    + '(frontend/** covered, 04_개발 preserved, no blanket trigger)\n',
);
