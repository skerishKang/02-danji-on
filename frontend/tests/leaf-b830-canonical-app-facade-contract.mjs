import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const src = await readFile(new URL('../assets/danjion-session.js', import.meta.url), 'utf8');
const ctx = { URLSearchParams, URL, console };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const S = ctx.DanjionSession;
assert.ok(S, 'DanjionSession must load');

for (const hostname of ['danjion.padiem.net', 'danjion.pages.dev']) {
  const loc = { hostname, origin: 'https://' + hostname, pathname: '/04_데일리홈.html', search: '?apiBase=https://evil.example' };
  assert.equal(S.danjionApiBase(loc), '', hostname + ' app API must remain same-origin and ignore apiBase override');
  assert.equal(S.danjionAuthBase(loc), '', hostname + ' auth API must remain same-origin and ignore apiBase override');
}
assert.equal(S.danjionApiBase({hostname:'preview.example',search:'?apiBase=https://qa.example',origin:'https://preview.example'}),'https://qa.example');
console.log('leaf-b830-canonical-app-facade-contract: PASS');
