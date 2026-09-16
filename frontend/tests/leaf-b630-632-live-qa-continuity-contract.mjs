import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');
const [shops, landing, session, css, admin, authority] = await Promise.all([
  read('../01_이웃가게_발견.html'),
  read('../index.html'),
  read('../assets/danjion-session.js'),
  read('../assets/danjion-service-header.css'),
  read('../admin/index.html'),
  read('../assets/danjion-admin-authority.js')
]);

/* #630 — route/user search state must survive async live API hydration. */
assert.match(shops, /const initial=new URLSearchParams\(location\.search\);query=\(initial\.get\('q'\)\|\|''\)\.trim\(\)/,
  'shop discovery must consume ?q= from the route');
assert.match(shops, /searchForm'\)\.addEventListener\('submit'[\s\S]*query=document\.getElementById\('searchInput'\)\.value\.trim\(\);draw\(\)/,
  'shop discovery must filter from the user-entered search value');

const hydrate = shops.match(/apiShops\(\)\.then\(list=>\{([\s\S]*?)console\.info\('\[danjion\] discovery API shops loaded:'/);
assert.ok(hydrate, 'live shop hydration success block must remain detectable');
assert.doesNotMatch(hydrate[1], /\bquery\s*=\s*['"]['"]/,
  'live hydration must never clear the active search query');
assert.doesNotMatch(hydrate[1], /searchInput['"]?\)\.value\s*=\s*['"]['"]/,
  'live hydration must never clear the search input');
assert.doesNotMatch(hydrate[1], /\bcurrentFilter\s*=\s*['"]all['"]/,
  'live hydration must never reset a filter selected before hydration completed');
assert.match(hydrate[1], /SHOP_DATA\.length=0[\s\S]*reconciled[\s\S]*draw\(\)/,
  'live hydration may replace underlying data and redraw using current UI state');

/* #631 — landing presentation must revalidate canonical server session on BFCache restore. */
assert.match(landing, /async function reconcileLandingSession\(\)/,
  'landing must centralize native session reconciliation');
assert.match(landing, /const real=await serverSessionCheck\(\)/,
  'landing reconciliation must use the canonical native Better Auth session check');
assert.match(landing, /memberMode=real;sessionResolved=true;syncMemberState\(\)/,
  'landing reconciliation must derive visible member state from the server verdict');
assert.match(landing, /sessionResolved=false;[\s\S]*adminAuthorized=false;[\s\S]*syncMemberState\(\)/,
  'landing must hide stale guest/member/admin controls while a restored page is being revalidated');
assert.match(landing, /window\.addEventListener\('pageshow',event=>\{if\(event\.persisted\)reconcileLandingSession\(\)\}\)/,
  'BFCache pageshow restore must trigger a fresh session read');
assert.match(landing, /if\(real\)refreshAdminEntry\(\);else adminAuthorized=false/,
  'guest verdict must never retain stale administrator presentation');

/* #632 — signed-out service shell gets navigation to the existing landing auth modal. */
assert.match(session, /if \(!nativeSessionReady\(session\)\) \{[\s\S]*canonicalProduction[\s\S]*PRODUCTION_PAGES_HOSTNAME/,
  'guest auth entry must be bounded to canonical Production service pages');
assert.match(session, /guestAuth\.href = 'index\.html\?auth=login'/,
  'guest service entry must route only to the canonical landing auth intent');
assert.match(session, /guestAuth\.textContent = '로그인 · 가입'/);
assert.match(session, /guestAuth\.setAttribute\('aria-label', '로그인 또는 가입'\)/);
assert.doesNotMatch(session, /guestAuth\.href\s*=\s*['"][^'"]*(?:email|user|accountId|token)/i,
  'guest auth route must never carry identity/session values');
assert.match(session, /host\.classList\.remove\('danjion-account-host'\)[\s\S]*host\.classList\.add\('danjion-guest-auth-host'\)/,
  'signed-out shell must not masquerade as the authenticated account host');
assert.match(session, /host\.classList\.remove\('danjion-guest-auth-host'\)[\s\S]*host\.classList\.add\('danjion-account-host'\)/,
  'authenticated shell must remove guest presentation before rendering the account menu');

assert.match(landing, /new URLSearchParams\(location\.search\)\.get\('auth'\)/,
  'landing must read the bounded guest auth intent');
assert.match(landing, /if\(intent!=='login'&&intent!=='signup'\)return/,
  'landing must allowlist only login/signup auth intents');
assert.match(landing, /next\.searchParams\.delete\('auth'\)[\s\S]*window\.history\.replaceState/,
  'landing must consume the auth query before opening modal history');
assert.match(landing, /if\(memberMode\)return;[\s\S]*mode=intent;[\s\S]*authModal\.open\('entry'\)/,
  'authenticated users must not receive the guest auth modal');

assert.match(css, /identity\.danjion-guest-auth-host[\s\S]*display:flex!important/,
  'guest auth host must be visible in the canonical service header');
assert.match(css, /@media \(max-width:760px\)[\s\S]*identity\.danjion-account-host\{display:none!important\}[\s\S]*identity\.danjion-guest-auth-host[\s\S]*display:flex!important/,
  'mobile must hide the full authenticated account menu while retaining the guest login entry');
assert.match(css, /danjion-guest-auth-entry[\s\S]*white-space:nowrap!important/,
  'guest entry must remain a compact single-line control');

/* QA admin-link verification — DOM href is not the authorization boundary. */
assert.match(landing, /adminEntry\.hidden=!sessionResolved\|\|!memberMode\|\|!adminAuthorized/,
  'landing admin entry must remain hidden without resolved server authority');
assert.match(admin, /authority\.fetchAuthority\(fetch\)\.then\(\(grant\)=>\{[\s\S]*authority\.hasAdminSurface\(grant\)\)renderConsole\(grant\);else showRestricted/,
  'admin console must independently gate rendering through server authority');
assert.match(authority, /if \(result\.status === 401\) return \{ state: 'signed-out' \}/);
assert.match(authority, /if \(result\.status === 403\) return \{ state: 'denied' \}/);

console.log('PASS #630/#631/#632 live QA continuity contracts');
