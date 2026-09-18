import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// #679 is preserved under the #735 code-first resident-verification model.
// Household association and resident verification remain distinct server states:
// a legacy/pending household association must never be presented as verified.

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');
const [page, bridge, myInfo] = await Promise.all([
  read('../26_우리집연결.html'),
  read('../assets/resident-verification-code-bridge.js'),
  read('../19_내정보_메인.html')
]);

assert.match(
  bridge,
  /const verified=String\(membership\.status\|\|''\)==='verified'\|\|membership\.residentVerified===true/,
  'household snapshot must derive verified state from membership verification, not association alone'
);
assert.match(
  bridge,
  /state:verified\?'verified':'unverified-associated'/,
  'a pending household association must remain explicitly unverified'
);

assert.match(
  page,
  /result\.state==='unverified'\|\|result\.state==='unverified-associated'/,
  'page 26 must route both no-association and pending-association states through the unverified UI'
);
assert.match(
  page,
  /result&&result\.state==='unverified-associated'[\s\S]*우리집 연결 기록은 있지만 주민인증은 아직 완료되지 않았습니다\./,
  'pending association copy must explicitly separate household linkage from resident verification'
);
assert.match(
  page,
  /function showVerified\(result\)[\s\S]*statusTitle\.textContent='주민인증 완료'/,
  'verified copy must remain isolated to the verified renderer'
);
assert.match(
  page,
  /if\(result\.state==='verified'\)\{showVerified\(result\);return\}/,
  'only the verified bridge state may enter the verified renderer'
);
assert.doesNotMatch(
  page,
  /localStorage|sessionStorage/,
  'resident/household authority must not be persisted in browser storage'
);

// My Info keeps its own explicit pending/verified vocabulary.
assert.ok(myInfo.includes("'주민인증 심사 대기 중'"), 'My Info pending copy must survive');
assert.ok(myInfo.includes("'주민인증 완료'"), 'My Info verified copy must survive');

console.log('PASS #679/#735 household association remains distinct from resident verification');
