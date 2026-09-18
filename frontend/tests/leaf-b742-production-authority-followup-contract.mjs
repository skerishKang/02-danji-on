import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const index = await readFile(new URL('index.html', root), 'utf8');
const warmth = await readFile(new URL('23_이웃온기.html', root), 'utf8');
const community = await readFile(new URL('12_이웃대화_첫화면.html', root), 'utf8');

assert.match(index, /button\.dataset\.residentNow!==undefined\)\{if\(serverMode\)\{authModal\.close\(\);location\.href='26_우리집연결\.html\?from=onboarding';return\}/,
  'canonical server signup must hand resident verification to the server-backed household flow');
assert.match(index, /residentStarted=!serverMode&&sessionStorage\.getItem\('danjionResidentCodeEntered'\)==='1'/,
  'server mode must never treat a browser resident-code marker as a real verification request');
assert.match(index, /type==='residentCode'\)\{if\(serverMode\)/,
  'server mode must fail closed if a stale prototype resident-code form is reached');

assert.match(warmth, /<button class="level-button active" data-level="1">/,
  'warmth page must default a fresh/unscored account to LV.1');
assert.doesNotMatch(warmth, /<button class="level-button active" data-level="3">/,
  'warmth page must not hardcode LV.3 as the current account state');
assert.match(warmth, /aria-label="이웃 온기 5단계 중 1단계"/,
  'warmth summary must be consistent with the LV.1 default');

assert.match(community, /list\.innerHTML=notice\('이웃대화를 불러오는 중입니다\.'\)/,
  'production server mode must clear prototype resident posts before awaiting authority');
assert.match(community, /아직 등록된 이웃대화가 없습니다\./,
  'an empty server collection must render an honest empty state');
assert.doesNotMatch(community, /community fallback preserved/,
  'server errors must not preserve prototype resident posts');

console.log('leaf-b742-production-authority-followup-contract: PASS');
