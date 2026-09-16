import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Issue #648: Production authenticated canary exposed a canonical frontend/backend
// contract mismatch. The admin console requested status=pending while the backend
// queue accepts submitted|reviewing|approved|rejected and defaults to submitted.
// Keep the canonical GET aligned so OPERATIONAL resident-news review never fails
// validation before the server evaluates resident_news.review authority.

const frontend = await readFile(new URL('../assets/danjion-admin-console.js', import.meta.url), 'utf8');
const backend = await readFile(new URL('../../04_개발/backend/src/resident-news-v1.ts', import.meta.url), 'utf8');

const canonicalPath = '/resident-news/submissions?status=submitted';
const stalePath = '/resident-news/submissions?status=pending';

assert.ok(
  frontend.includes(canonicalPath),
  'canonical admin console must request the backend-valid submitted resident-news queue'
);
assert.ok(
  !frontend.includes(stalePath),
  'canonical admin console must never request the invalid pending resident-news queue status'
);
assert.ok(
  backend.includes("const QUEUE_STATUSES = new Set(['submitted', 'reviewing', 'approved', 'rejected'])"),
  'backend queue-status authority must retain the reviewed submitted/reviewing/approved/rejected contract'
);
assert.ok(
  backend.includes("(url.searchParams.get('status') || 'submitted').trim()"),
  'backend queue GET must retain submitted as its default status'
);

console.log('leaf-b648-admin-resident-news-status-contract: PASS');
