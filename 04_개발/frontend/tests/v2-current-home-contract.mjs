import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [hero, cinematic, shell, visualEntry, authEntry, topbar, reference] = await Promise.all([
  readFile(new URL('src/v2/visual/V2Hero.tsx', root), 'utf8'),
  readFile(new URL('src/v2/visual/V2CinematicScenes.tsx', root), 'utf8'),
  readFile(new URL('src/v2/visual/v2-008-home.css', root), 'utf8'),
  readFile(new URL('src/v2/v2-visual.css', root), 'utf8'),
  readFile(new URL('src/v2/integration/V2AuthEntryPortal.tsx', root), 'utf8'),
  readFile(new URL('src/v2/visual/V2Topbar.tsx', root), 'utf8'),
  readFile(new URL('tests/v2/reference-contract.ts', root), 'utf8')
]);

assert.match(hero, /WELCOME HOME · \{complexName\}/,
  'current home must expose the 04 WELCOME HOME intro');
assert.match(hero, /필요한 일, 우리 단지에서 먼저 찾습니다\./,
  'current home must use the 04 heading');
assert.match(hero, /이웃이 실제로 일하는 장면/,
  'current home must preserve the 04 explanatory copy');
assert.match(hero, /placeholder="반찬 · 과외 · 청소 · 세무"/,
  'current home must use the compact 04 search placeholder');
assert.doesNotMatch(hero, /우리 아파트에,/,
  'historical Gate1 launch heading must not return as current home authority');
assert.doesNotMatch(hero, /가입하고 시작하기/,
  'historical Gate1 marketing CTA must not return inside the daily home');
assert.doesNotMatch(hero, /V2Gate1ResidentHome/,
  'historical Gate1 resident-home archive must not remain in current 04 composition');

assert.match(cinematic, /LIVING NEIGHBOR WORK/,
  'current cinematic stage must use the 04 scene-number semantics');
assert.match(cinematic, /단지온이 소개하는 이웃의 일/,
  'current cinematic stage must preserve the 04 caption kicker');
assert.match(cinematic, /aria-label="이웃가게 장면 선택"/,
  'current four-scene selector must expose the 04 accessible label');
assert.match(cinematic, /<V2DailyHomeSummary \/>/,
  'benefit/news summary must follow the cinematic stage');

assert.match(hero, /dataAdapter\.listPosts\(\)/,
  'home news summary must reuse canonical public post data instead of static fabricated notices');
assert.match(hero, /scrollToSection\('v2-discovery'\)/,
  'home resident-benefit summary must reuse the existing shop discovery flow');
assert.match(hero, /\[data-v2-nav-key="community"\]/,
  'home news summary must reuse the existing current community navigation hook');
assert.match(topbar, /data-v2-nav-key=\{item\.key\}/,
  'current common shell must expose stable navigation hooks for home summary links');

assert.match(shell, /height:610px/,
  'desktop/tablet current home cinematic stage must use finite 610px geometry');
assert.match(shell, /position:relative/,
  'current home must override the historical sticky cinematic stage');
assert.match(shell, /height:300px;min-height:300px/,
  'mobile current home must preserve the 300px scene visual');
assert.match(shell, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/,
  'mobile current home scene selector must use four equal columns');
assert.match(shell, /v2-008-home-summary/,
  'current home must include the benefit/news after-stage geometry');
assert.ok(visualEntry.trim().endsWith("@import './visual/v2-008-home.css';"),
  'current daily-home parity CSS must load last');

assert.match(authEntry, /\[data-v2-topbar\] \.v2-header-tools/,
  'canonical auth entry must remain mounted in the common header tools host');
assert.match(authEntry, /가입·로그인/,
  'canonical account launcher must remain available after removing the old Gate1 hero CTA');

assert.match(reference, /driveFileId: '1j0f5-UyK012HKuny4xsbZchbYXJ3oVsX'/,
  'fidelity reference must point at the exact current 04 Drive file');
assert.match(reference, /sha256: '267F6BAC8EF83A4AAC85D7D3C69A68A3901F652F2B59003C735575245C487110'/,
  'fidelity reference must pin the current 04 raw-file hash');

console.log('PASS V2 20260904 current daily-home parity contract');
