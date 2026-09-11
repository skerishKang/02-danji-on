import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../../../frontend/01_이웃가게_발견_v3.html', import.meta.url), 'utf8');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

/* --- GAP-6/7 bridge runtimes load before the shop runtime consumes them --- */
const benefitTag = html.indexOf('<script src="assets/benefit-claim-bridge.js"></script>');
const inquiryTag = html.indexOf('<script src="assets/inquiry-bridge.js"></script>');
const runtimeTag = html.indexOf('<script id="frontend2-b-shop-runtime-20260905">');
assert.ok(benefitTag > -1, 'benefit-claim bridge script tag must be present');
assert.ok(inquiryTag > -1, 'inquiry bridge script tag must be present');
assert.ok(benefitTag < runtimeTag, 'benefit-claim bridge must load before the shop runtime');
assert.ok(inquiryTag < runtimeTag, 'inquiry bridge must load before the shop runtime');

/* --- bridges are created with the discovery API base + complex slug, and booted --- */
assert.match(html, /DanjionBenefitClaimBridge\.createBenefitClaimBridge\(\{apiBase:DISCOVERY_API_BASE,complexSlug:DISCOVERY_COMPLEX_SLUG\}\)/,
  'benefit claim bridge must be created with the discovery API base and complex slug');
assert.match(html, /DanjionInquiryBridge\.createInquiryBridge\(\{apiBase:DISCOVERY_API_BASE,complexSlug:DISCOVERY_COMPLEX_SLUG\}\)/,
  'inquiry bridge must be created with the discovery API base and complex slug');
assert.match(html, /initBenefitClaimBridge\(\)/, 'benefit claim bridge must be booted');
assert.match(html, /initInquiryBridge\(\)/, 'inquiry bridge must be booted');

/* --- GAP-6: server benefit id is preserved so claims are grounded in real rows --- */
/* mapApiBusiness must be SELF-CONTAINED (stage5a extracts and evals it in isolation) */
const mapSrc = html.match(/function mapApiBusiness\(b,i\)\{[\s\S]*?\n \}/)?.[0];
assert.ok(mapSrc, 'mapApiBusiness must exist in the v3 discovery runtime');
assert.match(mapSrc, /\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[1-5\]/,
  'benefit UUID validation must live INSIDE mapApiBusiness (no outer-scope dependency)');
assert.match(mapSrc, /benefitId:[A-Z_a-z]+\.test\(benefitIdValue\)\?benefitIdValue:''/,
  'mapApiBusiness must carry a validated benefit UUID through to the shop record');
assert.doesNotMatch(mapSrc, /benefitIdFromValue/,
  'mapApiBusiness must not reference outer-scope helpers (stage5a isolation regression guard)');
assert.match(mapSrc, /benefit\.id!=null\?String\(benefit\.id\)/,
  'benefitId must come only from the API benefit row, never guessed');
assert.match(html, /__benefitClaimBridge\.claim\(s\.benefitId\)/,
  'coupon save must go through the benefit claim bridge');
assert.match(html, /if\(r\.mode==='auth-required'\)\{flash\('로그인 후 이용 가능합니다\.'\);return\}[\s\S]*?if\(r\.mode==='error'\)\{flash\('혜택 보관에 실패했습니다\.'\);return\}/,
  'claim failures must fail closed: auth-required surfaces login notice, errors never fake a local save');

/* --- GAP-7: shop inquiry submit goes through the inquiry bridge --- */
assert.match(html, /__inquiryBridge\.submit\(\{shopKey:active,shopName:sh\.name,subject,text\}\)/,
  'shop inquiry submit must go through the inquiry bridge');
assert.match(html, /inquiry-bridge|shop_inquiry/, 'inquiry lane label must stay shop_inquiry');
assert.doesNotMatch(html, /inquiryType:\s*['"](coupon|reserve|onsite)['"]/,
  'no benefit-mode inference may be introduced through the inquiry type');

/* --- benefit mode HOLD: coupon/reserve/onsite semantics must not be inferred server-side --- */
assert.doesNotMatch(html, /s\.benefitId\s*=\s*[^b]/, 'benefitId must only come from the API benefit row, never guessed');
assert.match(html, /benefit\.title\|\|'주민 전용 혜택'/, 'benefit display fallback must stay unchanged (no mode inference)');

/* --- static/demo boundary: demo shops keep the pre-existing local semantics --- */
assert.match(html, /danjion:demo:shop-inquiries/,
  'static demo shops must keep the localStorage demo inquiry lane (no server call, no fabricated UUIDs)');
assert.match(html, /danjion:savedBenefits/,
  'coupon save must keep the existing local savedBenefits mirror for UI state');

/* --- product copy preserved verbatim --- */
assert.match(html, /'문의가 접수됐습니다\.'/, 'inquiry success copy must be preserved');
assert.match(html, /'내정보의 받은 혜택에 보관했습니다\.'/, 'coupon save confirmation copy must be preserved');
assert.match(html, /'보관을 취소했습니다\.'/, 'coupon unsave copy must be preserved');
assert.match(html, /'문의 제목과 내용을 입력해 주세요\.'/, 'inquiry validation copy must be preserved');
assert.match(html, /'내 혜택에 보관'/, 'coupon save button label must be preserved');
assert.match(html, /'✓ 내 혜택에 보관됨'/, 'coupon saved label must be preserved');
assert.match(html, /'로그인 후 이용 가능합니다\.'/, 'auth-required notice must reuse the existing canonical copy');

/* --- additive tests present in the authoritative manifest (ordered, additive only) --- */
const manifest = JSON.parse(await readFile(new URL('../../test-runner.manifest.json', import.meta.url), 'utf8'));
const runIds = manifest.scopes.frontend.run.map((s) => s.npm || s.id);
const hasStep = (step) => runIds.some((id) => id === step || id.startsWith(step + '-'));
assert.ok(hasStep('test:stage5e-benefit-inquiry-bridge-runtime'),
  'manifest frontend suite must run the benefit/inquiry bridge runtime test');
assert.ok(hasStep('test:stage5f-gap67-wiring-contract'),
  'manifest frontend suite must run the GAP-6/7 wiring contract test');
for (const step of ['test:stage5b', 'test:stage5c', 'test:stage5d-application-report-bridge-runtime', 'test:v3-persistence-wiring-contract']) {
  assert.ok(hasStep(step), `existing suite step ${step} must be preserved`);
}
assert.ok(runIds.findIndex((id) => id.startsWith('test:stage5f')) > runIds.findIndex((id) => id.startsWith('test:stage5e')),
  'wiring contract must be ordered after the runtime contract');

console.log('PASS stage5f GAP-6/7 wiring contract (benefit claim + shop inquiry bridges)');
