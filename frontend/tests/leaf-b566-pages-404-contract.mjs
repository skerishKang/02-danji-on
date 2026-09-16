import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [notFound, releaseWorkflow] = await Promise.all([
  readFile(new URL('../404.html', import.meta.url), 'utf8'),
  readFile(new URL('../../.github/workflows/pages-production-release.yml', import.meta.url), 'utf8')
]);

assert.match(notFound, /<body data-danjion-page="404">/);
assert.match(notFound, /<meta name="robots" content="noindex,nofollow">/);
assert.match(notFound, /href="\/\?intro=1"/);
assert.doesNotMatch(notFound, /http-equiv\s*=\s*["']refresh["']/i);
assert.doesNotMatch(notFound, /location\.(?:replace|assign)|location\.href\s*=/i);

assert.match(releaseWorkflow, /test -f dist\/404\.html/);
assert.match(releaseWorkflow, /missing_status=.*%\{http_code\}/);
assert.match(releaseWorkflow, /if \[ "\$missing_status" != "404" \]/);
assert.match(releaseWorkflow, /data-danjion-page="404"/);
assert.match(releaseWorkflow, /sha256sum dist\/404\.html/);

console.log('PASS #566 top-level 404 disables Pages SPA soft-404 fallback and release readback enforces HTTP 404');
