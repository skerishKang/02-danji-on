import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { mapResidentProfile } from '../src/resident-profile-mapper.ts';
import {
  parseResidentLabel,
  residentProfileLabelEyebrow,
  residentProfileLabelText
} from '../src/resident-profile-label.ts';

const root = new URL('../', import.meta.url);
const clientSource = await readFile(fileURLToPath(new URL('src/resident-profile-client.ts', root)), 'utf8');
const mapperSource = await readFile(fileURLToPath(new URL('src/resident-profile-mapper.ts', root)), 'utf8');
const integrationSource = await readFile(fileURLToPath(new URL('src/v2/integration/V2ResidentProfileIntegration.tsx', root)), 'utf8');

const known = ['verified_resident', 'operator', 'account'];
for (const label of known) {
  assert.equal(parseResidentLabel(label), label, `known label must remain exact: ${label}`);
  assert.equal(residentProfileLabelText(label), label === 'verified_resident' ? '인증 주민' : label === 'operator' ? '운영자 계정' : '로그인 계정');
}

for (const raw of [undefined, null, '', 'something_new', 123, {}]) {
  assert.equal(parseResidentLabel(raw), 'unknown', `malformed label must fail closed: ${String(raw)}`);
  assert.equal(residentProfileLabelText('unknown'), '프로필 상태 확인 필요');
  assert.equal(residentProfileLabelEyebrow('unknown'), 'PROFILE STATUS');
}

const base = {
  userId: 'user-1',
  nickname: '프로필',
  avatarUrl: null,
  joinedMonth: '2026-09',
  publicBio: '소개',
  publicActivityCount: 3
};
for (const [raw, expected] of [
  ['verified_resident', 'verified_resident'],
  ['operator', 'operator'],
  ['account', 'account'],
  [undefined, 'unknown'],
  [null, 'unknown'],
  ['', 'unknown'],
  ['something_new', 'unknown'],
  [123, 'unknown'],
  [{}, 'unknown']
]) {
  const payload = { ...base, ...(raw === undefined ? {} : { residentLabel: raw }) };
  assert.equal(mapResidentProfile(payload).residentLabel, expected, `mapper must map ${String(raw)} to ${expected}`);
}

assert.equal(residentProfileLabelText('operator'), '운영자 계정');
assert.notEqual(residentProfileLabelText('operator'), '인증 주민');
assert.equal(residentProfileLabelText('account'), '로그인 계정');
assert.notEqual(residentProfileLabelText('account'), '인증 주민');
assert.notEqual(residentProfileLabelText('unknown'), '인증 주민');
assert.equal(residentProfileLabelEyebrow('operator'), 'OPERATOR ACCOUNT');
assert.equal(residentProfileLabelEyebrow('account'), 'ACCOUNT');
assert.notEqual(residentProfileLabelEyebrow('unknown'), 'VERIFIED RESIDENT');

assert.doesNotMatch(clientSource, /'verified_resident'\s*\|\s*string/,
  'broad resident label type must be removed');
assert.doesNotMatch(mapperSource, /String\(value\.residentLabel\s*\?\?\s*'verified_resident'\)/,
  'mapper must not synthesize verified_resident');
assert.match(mapperSource, /residentLabel:\s*parseResidentLabel\(value\.residentLabel\)/,
  'mapper must use the explicit label parser');
assert.match(clientSource, /mapResidentProfile/,
  'API response mapping must use the bounded mapper');
assert.match(integrationSource, /residentProfileLabelText\(selfProfile\.residentLabel\)/,
  'self profile presentation must be label-driven');
assert.match(integrationSource, /residentProfileLabelText\(otherProfile\.residentLabel\)/,
  'other profile presentation must be label-driven');
assert.match(integrationSource, /residentProfileLabelEyebrow\(otherProfile\.residentLabel\)/,
  'other profile eyebrow must be label-driven');
assert.doesNotMatch(integrationSource, /<p>인증 주민 · 가입/,
  'self profile must not hardcode verified resident copy');
assert.doesNotMatch(integrationSource, /<span className="v2-eyebrow">VERIFIED RESIDENT<\/span>/,
  'other profile must not hardcode verified resident eyebrow');

console.log('resident-profile-label-983-contract: PASS');
console.log('KNOWN_LABELS=verified_resident,operator,account');
console.log('MISSING_NULL_EMPTY_UNKNOWN=unknown_not_verified');
console.log('SELF_OPERATOR_ACCOUNT_UNKNOWN_NOT_VERIFIED=PASS');
console.log('OTHER_UNKNOWN_NOT_VERIFIED=PASS');
console.log('BROAD_LABEL_TYPE=REMOVED');
