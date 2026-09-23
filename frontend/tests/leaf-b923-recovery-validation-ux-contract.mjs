import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Issue #923 [FRONTEND_UX_RECOVERY]:
// 1) Community detail must render an accessible recovery state (not an empty shell)
//    when ?post= is missing/invalid, before any server post fetch, with a keyboard
//    link back to the community list.
// 2) 25A application validation must surface an application-level error summary,
//    scroll/focus the first actionable target, preserve inline attachment errors,
//    and keep every fail-closed validation rule (proof 1~3, counts, sizes, formats).
// 3) Relation audit: family/neighbor/nearby/etc are intentional raw values; the
//    server-side family -> resident_family projection is #341 authority.

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.join(here, '..');
const detail = readFileSync(path.join(frontend, '13_이웃대화_글상세_댓글.html'), 'utf8');
const form = readFileSync(path.join(frontend, '25A_신청제보.html'), 'utf8');
const bridge = readFileSync(path.join(frontend, 'assets/application-report-bridge.js'), 'utf8');

// --- Community detail recovery ---------------------------------------------
assert.match(
  detail,
  /class="post-recovery"[^>]*hidden[^>]*id="postRecovery"|id="postRecovery"[^>]*hidden/,
  'recovery section must exist and start hidden',
);
assert.match(
  detail,
  /id="postRecoveryHeading"/,
  'recovery heading must exist',
);
assert.equal(
  [...detail.matchAll(/<h1\b[^>]*>/gi)].length,
  1,
  'recovery must not introduce a second literal H1 (leaf-b639)',
);
assert.ok(detail.includes('id="postRecoveryDetail"'), 'recovery detail copy must exist');
assert.ok(
  detail.includes('id="postRecoveryLink"') && detail.includes('href="12_이웃대화_첫화면.html"'),
  'recovery link must point at the canonical community list',
);
assert.ok(
  detail.includes('12_이웃대화_첫화면.html'),
  'recovery must expose an explicit list recovery path',
);
assert.match(
  detail,
  /if\(!UUID\.test\(postId\)\)showPostRecovery\(/,
  'invalid/missing post id must invoke recovery before any load path',
);
assert.ok(
  detail.includes('if(!UUID.test(postId))return;'),
  'UUID gate early-return must stay (leaf-b531/b527 lock)',
);
const recoveryCall = detail.indexOf('showPostRecovery(');
const uuidReturn = detail.indexOf('if(!UUID.test(postId))return;');
const loadingCall = detail.indexOf('enterServerLoadingState();');
assert.ok(recoveryCall >= 0 && uuidReturn > recoveryCall, 'recovery must run before the UUID early-return');
assert.ok(loadingCall > uuidReturn, 'loading state must remain after the UUID gate (leaf-b531)');
assert.match(
  detail,
  /shell\.hidden=true/,
  'invalid recovery must hide the empty prototype shell',
);
assert.match(
  detail,
  /comments\.hidden=true/,
  'invalid recovery must hide the prototype comments block',
);
assert.ok(
  !/alert\(/.test(detail.slice(recoveryCall, recoveryCall + 800)),
  'recovery must not use alert()',
);

// --- 25A application error summary -----------------------------------------
assert.ok(
  form.includes('id="applicationErrorSummary"') && form.includes('role="alert"'),
  'application-level error summary must exist with role=alert',
);
assert.match(
  form,
  /<form class="form mode-owner" id="requestForm" novalidate/,
  'request form must use novalidate so the application-level summary can surface on submit',
);
assert.ok(
  form.includes('aria-live="assertive"'),
  'error summary must announce assertively',
);
assert.match(form, /function revealApplicationError\(/, 'reveal helper must exist');
assert.match(form, /function clearApplicationError\(/, 'clear helper must exist');
assert.match(
  form,
  /scrollIntoView\(\{behavior:prefersReducedMotion\(\)\?'auto':'smooth',block:'center'\}\)|scrollIntoView\(/,
  'first-error reveal must scroll into view',
);
assert.ok(
  !/window\.scrollTo\(0,0\)/.test(form),
  'must not force top-of-page scrollTo(0,0)',
);
assert.ok(
  form.includes("revealApplicationError('필수 항목을 다시 확인해 주세요.',firstInvalidVisibleField())"),
  'native reportValidity failure must update summary + focus first invalid',
);
assert.match(
  form,
  /if\(proofFiles\.length<1\|\|proofFiles\.length>MAX_OWNER_DOCS\)\{[\s\S]{0,500}const message='운영 확인서류는 1~3개를 첨부해 주세요\.';[\s\S]{0,500}ownerProof\.error[\s\S]{0,400}revealApplicationError\(message,/,
  'proof-count failure must keep the 1~3 rule AND set inline ownerProofError + summary',
);
assert.ok(
  form.includes("group.error.textContent='업로드에 실패했습니다. 등록 신청하기를 다시 눌러 재시도하세요.'"),
  'upload failure must preserve the inline group error text',
);
assert.ok(
  form.includes("if(!businessName||!categoryName||!serviceSummary)") &&
    form.includes("revealApplicationError('필수 항목을 다시 확인해 주세요.',firstMissing"),
  'owner required-field failure must announce via summary, not toast alone',
);
assert.ok(
  form.includes("if(!OWNER_RELATIONS.has(relationRaw))") &&
    form.includes('revealApplicationError(\'선택한 관계로는 아직 서버 신청을 연결할 수 없습니다.\''),
  'relation gate failure must stay fail-closed and surface via summary',
);
assert.ok(
  form.includes('if(otherFiles.length>3||extraFiles.length>3)') &&
    form.includes('증빙·참고자료는 각 최대 3개까지 첨부할 수 있습니다'),
  'extra evidence count rule must stay fail-closed',
);
assert.ok(
  form.includes('if(photoFiles.length>MAX_PHOTOS)'),
  'photo max rule must stay fail-closed',
);
assert.match(
  form,
  /function resetUploadState\(\)\{[\s\S]{0,800}if\(typeof clearApplicationError==='function'\)clearApplicationError\(\);/,
  'mode switch / edit must clear a stale application summary via resetUploadState',
);

// --- Relation contract (audit-only; no change) ------------------------------
assert.ok(
  bridge.includes("const OWNER_RELATION_RAW = new Set(['self', 'co', 'family', 'etc'])"),
  'owner raw relation set must keep family/co/etc (#341 verbatim forward)',
);
assert.ok(
  bridge.includes('family -> resident_family is') || bridge.includes('family -> resident_family'),
  'server-side family -> resident_family projection must remain documented as authority',
);
assert.match(
  form,
  /<option value="family">주민 가족 운영<\/option>/,
  'owner select family value must stay raw family (display label only)',
);
assert.match(
  form,
  /<option value="family">우리 가족이 운영<\/option>/,
  'report relation family must stay raw family',
);
assert.ok(
  form.includes("const OWNER_RELATIONS=new Set(['self','co','family','etc'])"),
  '25A OWNER_RELATIONS must accept the raw family value',
);

// Runtime syntax: both live wiring / main form scripts must parse.
const detailLive = detail.match(/<script id="danjion-community-detail-live-wiring-329">([\s\S]*?)<\/script>/);
assert.ok(detailLive, 'community detail live wiring must exist');
assert.doesNotThrow(() => new Function(detailLive[1]), 'community detail live wiring must parse');
const formScripts = [...form.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const formMain = formScripts.find((body) => body.includes("const f=document.querySelector('#requestForm')"));
assert.ok(formMain, '25A main form script must exist');
assert.doesNotThrow(() => new Function(formMain), '25A main form script must parse');

console.log('PASS leaf-b923 recovery + application validation UX contract');
