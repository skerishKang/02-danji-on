import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const session = await readFile(new URL('../assets/danjion-session.js', import.meta.url), 'utf8');
const my = await readFile(new URL('../19_내정보_메인.html', import.meta.url), 'utf8');

assert.ok(!session.includes("className = 'danjion-account-session'"),
  'floating account box must be removed');
assert.ok(session.includes("className = 'danjion-account-trigger'"),
  'account UI must use an integrated header trigger');
assert.ok(session.includes("document.querySelector('.identity') || document.querySelector('[data-account-host]')"),
  'account control must reuse the existing header identity slot');
assert.ok(session.includes("my.href = '19_내정보_메인.html'"));
assert.ok(session.includes("settings.href = '24_설정.html'"));
assert.ok(session.includes("'/api/auth/sign-out'"));
assert.ok(session.includes("location.href = 'index.html?intro=1'"));

const ctx = {
  location: { hostname: 'danjion.pages.dev', pathname: '/04_데일리홈.html', search: '' },
  URL,
  URLSearchParams,
  console
};
vm.createContext(ctx);
vm.runInContext(session, ctx);
const S = ctx.DanjionSession;
assert.equal(S.normalizeAccountAuthority({ ok: true, data: { level: 'admin', wildcard: true, scopes: ['*'] } }).label, '최고관리자');
assert.equal(S.normalizeAccountAuthority({ ok: true, data: { level: 'operator', wildcard: false, scopes: ['business.review'] } }).label, '운영관리자');
assert.equal(S.normalizeAccountAuthority({ ok: false, status: 403 }).label, '일반회원');
assert.equal(S.normalizeAccountAuthority({ ok: true, data: { level: 'admin', wildcard: false, scopes: ['business.review'] } }).canAdmin, false,
  'malformed authority must fail closed');
assert.ok(session.includes("joinUrl(apiBase, '/api/v1/admin/authority')"),
  'global account shell authority must come from the canonical server endpoint');
assert.ok(session.includes("admin.href = '/admin/'") && session.includes('if (authority.canAdmin)'),
  'dropdown admin console link must exist only behind the resolved server authority gate');
assert.ok(session.includes("adminQuickEntry.className = 'danjion-admin-quick-entry'") &&
          session.includes("adminQuickEntry.href = '/admin/'") &&
          session.includes("if (adminQuickEntry) host.append(adminQuickEntry)"),
  'valid admin/operator authority must render a persistent header-level admin console entry');
assert.ok(session.includes('flex-direction:row!important') && session.includes('flex-wrap:nowrap!important'),
  'persistent admin entry and account identity must stay on one horizontal row');
assert.ok(session.includes('border-radius:0') && session.includes('border:1px solid var(--amber,#c58a2a)'),
  'persistent admin entry must use the rectangular Intro-style outline treatment rather than a pill');
assert.ok(!session.includes('skerish@naver.com') && !session.includes('padiemipu@gmail.com') &&
          !session.includes('charliekant@gmail.com') && !session.includes('muphobia2@gmail.com'),
  'persistent admin entry must not hardcode administrator addresses');
assert.ok(session.includes("authorityNode.textContent = authority.label ? '권한 · ' + authority.label"),
  'the account menu must visibly separate authority from user identity');
assert.ok(session.includes("authKind.hasSocial") && session.includes("소셜 로그인 계정"),
  'social login accounts must keep provider-aware privacy copy instead of exposing provider contact email');

for (const label of ['홈','인트로','이웃가게','우리단지','내정보']) {
  assert.ok(my.includes(`>${label}<`), `My Info header must contain ${label}`);
}
assert.ok(my.includes('data-route="index.html?intro=1"'),
  'Intro must use the explicit intro route');
assert.ok(my.includes('data-account-host'),
  'My Info must expose the header account host');

console.log('leaf-b483-unified-header-account-menu-contract: PASS');
