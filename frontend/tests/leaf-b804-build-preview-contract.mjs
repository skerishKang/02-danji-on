import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../app.html', import.meta.url), 'utf8');
const landing = await readFile(new URL('../index.html', import.meta.url), 'utf8');

// Issue #804: /app build attribution must be immutable and deployment-scoped.
// Navigation-time or runtime clock generation is forbidden.
assert.doesNotMatch(app, /build=20260907/, 'app shell must not pin the obsolete 2026-09-07 build');
assert.doesNotMatch(app, /document\.lastModified/, 'app shell must not use navigation/document.lastModified time');
assert.doesNotMatch(app, /Date\.now/, 'app shell must not use runtime Date.now()');
assert.doesNotMatch(app, /new\s+Date\b/, 'app shell must not generate runtime Date objects');
assert.match(app, /data-build/, 'app shell must declare an immutable data-build attribution attribute');
assert.match(app, /searchParams\.set\('build',\s*build\)/, 'derived build stamp must reach the iframe URL');

const preview = landing.match(/document\.querySelectorAll\('\[data-preview\]'\)[\s\S]*?\}\)\);/);
assert.ok(preview, 'preview CTA handler must remain detectable');
assert.match(preview[0], /sessionStorage\.setItem\('danjionGuest','1'\)/,
  'guest preview must explicitly enter guest mode');
assert.match(preview[0], /location\.href='04_데일리홈\.html'/,
  'guest preview must enter the product instead of scrolling');
assert.doesNotMatch(preview[0], /scrollIntoView/,
  'preview CTA must not masquerade as a greeting scroll');

console.log('leaf-b804-build-preview-contract: PASS');
