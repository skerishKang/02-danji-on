import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const workflowPath = resolve(here, '../../../.github/workflows/cloudflare-preview.yml');
const workflow = readFileSync(workflowPath, 'utf8');

function includes(value, message) {
  assert.equal(workflow.includes(value), true, message);
}

function excludes(value, message) {
  assert.equal(workflow.includes(value), false, message);
}

includes('WORKER_NAME: padiem-danjion-api-preview', 'Track E must target only the dedicated preview Worker.');
includes('WORKER_PREVIEW_ALIAS: track-e', 'Track E must keep the stable track-e Worker preview alias.');
includes('PAGES_BRANCH: track-e', 'Track E must keep the track-e Pages preview branch.');
includes('DANJION_DATABASE_URL: ${{ secrets.DANJION_PREVIEW_DATABASE_URL }}', 'Track E must source its DB from the non-production preview-child secret.');
excludes('DANJION_DATABASE_URL: ${{ secrets.DATABASE_URL }}', 'Track E must never fall back to the production/legacy DATABASE_URL secret.');

includes('feat/live-stack-integration|feat/track-e-preview-fix-reconciliation', 'Only Track E and its explicit reconciliation branch may pass the preview branch guard.');
includes('test "${WORKER_NAME}" != "padiem-danjion-api-production"', 'Workflow must explicitly reject the production Worker name.');

includes("elif grep -Fq 'does not yet exist' \"$first_log\"; then", 'Worker bootstrap must be limited to the exact first-time absence condition.');
includes('npx wrangler deploy \\\n              --env "${WORKER_ENV}"', 'First-time bootstrap must still target the explicit preview environment.');
includes('npx wrangler versions upload', 'Normal Worker path must remain version upload, not an unconditional deploy.');
includes('--preview-alias "${WORKER_PREVIEW_ALIAS}"', 'Worker version upload must assign the Track E preview alias.');

includes('/workers/scripts/${WORKER_NAME}/subdomain', 'Workflow must configure Worker subdomain routing explicitly.');
includes("--data '{\"enabled\":false,\"previews_enabled\":true}'", 'Stable workers.dev routing must be disabled while version preview URLs remain enabled.');

includes('/pages/projects/${PAGES_PROJECT}', 'Pages idempotency check must query the exact project endpoint.');
includes('if [ "$http_code" = "200" ]; then', 'Existing Pages project must be accepted on HTTP 200.');
includes('elif [ "$http_code" = "404" ]; then', 'Pages project creation must occur only on HTTP 404.');
includes('Unexpected Cloudflare Pages project lookup HTTP status', 'Unexpected Pages lookup responses must fail closed.');

includes('cloudflare-preview-20260808 (br-hidden-frog-azdevrqe), never production', 'Secret gate must document the approved Neon child and production prohibition.');

console.log('Cloudflare Track E preview contract PASS');
