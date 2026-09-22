import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Issue #866 [25A 신청제보 / Report Attachments]:
// The report (제보) lane used to expose a photo picker whose selection never reached the
// server: submitReport() has no upload lane, so the UI showed "photo attached" while the
// persisted recommendation record carried no object key. Commit 863dcb3 resolved this by
// the product decision "remove the affordance" — the photo control moved to `owner-only`
// and the report notice now states that attachments are out of the report contract.
//
// There is no runtime contract protecting that decision, so a future edit could silently
// re-introduce a file input inside the report lane and restore the exact lie the issue
// reported. This test pins the decision; it does NOT add or change any feature.
//
// Scope is deliberately narrow (per the #866 work order):
//   1. report lane  -> no file affordance, no attachment path in submitReport()
//   2. owner lane   -> photo/document inputs and upload flow preserved
// Out of scope: report photo feature re-introduction, server attachment schema,
// operator read path, #829.

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', '25A_신청제보.html'), 'utf8');

// Extract a function body by brace balancing from its first `{` after the header.
// Regex-only extraction is brittle here: these files mix `){\n` and `) {\n` and nest
// block-scoped `}` at deeper indentation, which a lazy `[\s\S]*?\n\}` truncates early.
function bodyOf(source, header) {
  const at = source.indexOf(header);
  if (at < 0) return null;
  const open = source.indexOf('{', at + header.length);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

// Return the class list of the innermost element that encloses `needle`.
// String proximity (`lastIndexOf('owner-only')`) is NOT sufficient here: an unrelated
// owner-only <section> earlier in the document would satisfy it while the real wrapper
// was report-visible. We therefore walk the real open/close tag stream.
const VOID_TAGS = new Set(['input', 'br', 'img', 'hr', 'meta', 'link']);
function enclosingClasses(source, needle) {
  const target = source.indexOf(needle);
  assert.ok(target > 0, `needle not found: ${needle}`);
  const stack = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(source)) !== null) {
    if (m.index >= target) break;
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    const attrs = m[3] || '';
    if (closing) {
      // pop to the matching opener
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].name === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    if (VOID_TAGS.has(name) || /\/\s*$/.test(attrs)) continue;
    const cls = /\bclass="([^"]*)"/.exec(attrs)?.[1] || '';
    stack.push({ name, cls });
  }
  // Innermost enclosing chain: every scope class from the target's parent outward.
  return stack.map((s) => s.cls);
}

// ---------------------------------------------------------------------------
// 0) The lane-gating CSS that makes `owner-only` / `report-only` meaningful must
//    survive. If these rules disappear, the class markers below become inert and
//    an owner-only photo control would render in report mode again.
// ---------------------------------------------------------------------------
assert.match(
  src,
  /\.mode-report \.owner-only\{display:none\}/,
  'report mode must hide every owner-only block (otherwise the photo control leaks into report mode)'
);
assert.match(
  src,
  /\.mode-owner \.report-only\{display:none\}/,
  'owner mode must hide every report-only block'
);

// ---------------------------------------------------------------------------
// 1) REPORT LANE — no file affordance.
//    Real DOM nesting walk: every element bearing `report-only`, and everything
//    nested inside it, must be free of file-picker affordances. A 400-char window
//    is NOT enough (an injected control can sit past it), so we slice to the
//    matching close tag using the same tag stack as enclosingClasses().
// ---------------------------------------------------------------------------
function subtreeOf(source, startIdx) {
  const openTag = /<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/.exec(source.slice(startIdx));
  if (!openTag) return '';
  const rootName = openTag[1].toLowerCase();
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  tagRe.lastIndex = startIdx;
  let depth = 0;
  let m;
  while ((m = tagRe.exec(source)) !== null) {
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    if (name !== rootName) continue;
    if (!closing) depth += 1;
    else {
      depth -= 1;
      if (depth === 0) return source.slice(startIdx, tagRe.lastIndex);
    }
  }
  return source.slice(startIdx);
}

function scopeBlocks(source, className) {
  const blocks = [];
  const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*class="([^"]*)"[^>]*>/g;
  let m;
  while ((m = tagRe.exec(source)) !== null) {
    if (!m[2].split(/\s+/).includes(className)) continue;
    blocks.push(subtreeOf(source, m.index));
  }
  return blocks;
}

const reportBlocks = scopeBlocks(src, 'report-only');
assert.ok(reportBlocks.length >= 2, `expected several report-only blocks, found ${reportBlocks.length}`);

// Sanity: the scanned blocks must actually be non-trivial subtrees, otherwise the
// assertion below could pass vacuously on empty strings.
assert.ok(
  reportBlocks.every((b) => b.length > 40),
  'report-only subtrees must be extracted with real content'
);

for (const [i, block] of reportBlocks.entries()) {
  assert.doesNotMatch(
    block,
    /type="file"/,
    `report-only block #${i} must not contain a file input (a report photo picker has no server lane)`
  );
  assert.doesNotMatch(
    block,
    /data-file-add=/,
    `report-only block #${i} must not contain a file-add trigger`
  );
  assert.doesNotMatch(block, /class="file-status"/, `report-only block #${i} must not contain an upload status label`);
  assert.doesNotMatch(block, /class="file-list"/, `report-only block #${i} must not contain an upload list`);
  assert.doesNotMatch(block, /class="upload-error"/, `report-only block #${i} must not contain an upload error slot`);
}

// The single report-lane upload notice must state the exclusion explicitly, so a
// reader (and the next editor) sees why no control is present.
assert.match(
  src,
  /class="upload report-only"><b>제보자는 확인서류가 없어도 됩니다\.<\/b><p>사진 첨부는 현재 제보 접수 계약에 포함되지 않습니다\./,
  'the report lane must keep the explicit "attachments are not part of the report contract" notice'
);

// No file input may be reachable from the report lane through the disabled sweep
// either: `.report-only` elements are the set toggled by setMode, and a file input
// inside that set would be enabled in report mode.
const reportDisabledSweep = src.match(
  /document\.querySelectorAll\('\.report-only [^']*'\)\.forEach/
)?.[0];
assert.equal(
  reportDisabledSweep,
  "document.querySelectorAll('.report-only input,.report-only textarea,.report-only select').forEach",
  'the report-lane disabled sweep must target only input/textarea/select, never a file control'
);

// ---------------------------------------------------------------------------
// 2) REPORT SUBMIT PATH — no attachment authority.
//    submitReport() must not read the accumulating-file registry, must not carry
//    an object key, and must not hand an upload to the canonical bridge.
// ---------------------------------------------------------------------------
const submitReport = bodyOf(src, 'async function submitReport()');
assert.ok(submitReport, 'submitReport() must exist');

assert.doesNotMatch(
  submitReport,
  /fileGroups/,
  'submitReport() must not read the accumulating-file registry (report has no attachment lane)'
);
assert.doesNotMatch(
  submitReport,
  /uploadBusinessImage|uploadApplicationDocument/,
  'submitReport() must not upload files (that is the owner lane only)'
);
assert.doesNotMatch(
  submitReport,
  /objectKey|photoObjectKeys|uploadedKeys|documents/,
  'submitReport() must not attach object keys or document arrays to the recommendation payload'
);

// The report payload must stay exactly the textual recommendation contract.
assert.match(
  submitReport,
  /bridge\.createRecommendation\(\{relationRaw,businessName,serviceSummary,/,
  'report submission must still go through the canonical recommendation bridge with the textual payload'
);
assert.match(
  submitReport,
  /serviceArea:reportInput\('reportLocation'\),reporterNote:reportInput\('reportReason'\),/,
  'the report payload fields must stay unchanged'
);

// Server-side shape: reportPayload() builds the wire body and it must never learn
// an attachment field. This is the server-contract half of the same decision.
const bridgeSrc = readFileSync(path.join(here, '..', 'assets', 'application-report-bridge.js'), 'utf8');
const reportPayload = bodyOf(bridgeSrc, 'function reportPayload(input, complexSlug)');
assert.ok(reportPayload, 'reportPayload() must exist in the report bridge');
assert.doesNotMatch(
  reportPayload,
  /objectKey|photoObjectKeys|documents|attachment/i,
  'reportPayload() must not emit any attachment field into the recommendation request body'
);
assert.match(
  reportPayload,
  /if \(!relationRaw \|\| relationRaw\.length > 120 \|\| !businessName \|\| !serviceSummary\) return null;/,
  'reportPayload() required-field validation must stay unchanged'
);

// Readback: the recommendation normalizer must not pretend to hydrate attachments.
const normalizeRecommendation = bodyOf(bridgeSrc, 'export function normalizeRecommendation(row)');
assert.ok(normalizeRecommendation, 'normalizeRecommendation() must exist');
assert.doesNotMatch(
  normalizeRecommendation,
  /objectKey|photoObjectKeys|documents|attachment/i,
  'normalizeRecommendation() must not surface attachment fields (no report attachment readback exists)'
);

// ---------------------------------------------------------------------------
// 3) OWNER LANE — the existing attachment contract must be preserved.
// ---------------------------------------------------------------------------
function assertOwnerInput(id) {
  const re = new RegExp(
    `<input[^>]*hidden=""[^>]*id="${id}"[^>]*type="file"|<input[^>]*hidden=""[^>]*type="file"[^>]*id="${id}"`
  );
  assert.match(src, re, `owner input #${id} must remain a hidden file input`);
  assert.match(
    src,
    new RegExp(`data-file-add="${id}"`),
    `owner input #${id} must keep its file-add trigger`
  );
  assert.match(
    src,
    new RegExp(`bindAccumulatingFiles\\(document\\.querySelector\\('#${id}'\\)`),
    `owner input #${id} must stay bound to its accumulating-file group`
  );
}

for (const id of ['photos', 'ownerProof', 'ownerOtherDocs', 'extraDocs']) {
  assertOwnerInput(id);
}

// Every photo/document input must sit inside an owner-only scope so report mode
// never displays it. This is the precise regression #866 is about: the control was
// report-visible because its wrapper lacked `owner-only`.
for (const id of ['photos', 'extraDocs', 'ownerProof', 'ownerOtherDocs']) {
  const chain = enclosingClasses(src, `id="${id}"`);
  const ownerScoped = chain.some((cls) => cls.split(/\s+/).includes('owner-only'));
  const reportScoped = chain.some((cls) => cls.split(/\s+/).includes('report-only'));
  assert.ok(
    ownerScoped,
    `#${id} must be nested inside an owner-only element; enclosing chain = ${JSON.stringify(chain)}`
  );
  assert.ok(
    !reportScoped,
    `#${id} must never be inside a report-only element (that is the #866 affordance lie); chain = ${JSON.stringify(chain)}`
  );
}

// The report lane's own notice must NOT be owner-scoped, otherwise it would vanish
// in report mode and the exclusion would go unexplained.
{
  const chain = enclosingClasses(src, '사진 첨부는 현재 제보 접수 계약에 포함되지 않습니다');
  const ownerScoped = chain.some((cls) => cls.split(/\s+/).includes('owner-only'));
  assert.ok(!ownerScoped, 'the report exclusion notice must stay visible in report mode (not owner-only)');
}

// Owner submit must keep its full upload flow and object-key wiring.
assert.match(
  src,
  /const photoFiles=fileGroups\.photos\.entries;/,
  'owner submit must still read the photos group'
);
assert.match(
  src,
  /const upload=await uploadBusinessImage\(entry\.file,entry\.idempotencyKey\);/,
  'owner photo upload call must stay wired'
);
assert.match(
  src,
  /const upload=await uploadApplicationDocument\(entry\.file,entry\.idempotencyKey\);/,
  'owner document upload call must stay wired'
);
assert.match(
  src,
  /photoObjectKeys:uploadedKeys,documents\}/,
  'owner application payload must still carry photoObjectKeys and documents'
);
assert.match(
  src,
  /documents\.push\(\{objectKey:entry\.key,kind,sortOrder:i\}\);/,
  'owner document object-key attribution must stay intact'
);

// Owner failure must never be reported as success (an attachment upload failure has
// to short-circuit BEFORE createOwnerApplication). The assertion is structural: we
// slice the photo-upload loop itself and require that its `!upload.ok` guard ends in
// an unconditional `return;` — a lazy cross-file search would be satisfied by any
// later unrelated `return` and would miss `if(false&&!upload.ok)` being introduced.
const photoLoop = src.slice(
  src.indexOf('for(const entry of photoFiles){'),
  src.indexOf('const documents=[];', src.indexOf('for(const entry of photoFiles){'))
);
assert.ok(photoLoop.length > 0, 'the owner photo upload loop must exist');
assert.match(
  photoLoop,
  /const upload=await uploadBusinessImage\(entry\.file,entry\.idempotencyKey\);\s*if\(!upload\.ok\)\{[\s\S]*?\n\s*return;\s*\}/,
  'the owner photo upload guard must be an unconditional `if(!upload.ok){…return;}`'
);
assert.doesNotMatch(
  photoLoop,
  /if\(\s*(?:false|0|null|undefined|'')\s*&&\s*!upload\.ok\)/,
  'the owner upload failure guard must not be neutered by a falsy prefix'
);

// Same structural requirement for the document lane.
const docLoop = src.slice(
  src.indexOf("for(const [kind,files,group] of [['operation_proof'"),
  src.indexOf('const result=await bridge.createOwnerApplication(')
);
assert.ok(docLoop.length > 0, 'the owner document upload loop must exist');
assert.match(
  docLoop,
  /const upload=await uploadApplicationDocument\(entry\.file,entry\.idempotencyKey\);\s*if\(!upload\.ok\)\{[\s\S]*?\n\s*return;\s*\}/,
  'the owner document upload guard must short-circuit before submitting'
);

// ---------------------------------------------------------------------------
// 4) The lane toggle must keep the report lane free of upload state, so that a
//    mode switch cannot enable a file control that only exists for owner mode.
// ---------------------------------------------------------------------------
assert.match(
  src,
  /function setMode\(m\)\{[\s\S]*?resetUploadState\(\);[\s\S]*?syncDisabled\(isReport\?'report':'owner'\);/,
  'setMode must reset upload state and re-assert control disabled state'
);

console.log('leaf-b866-report-no-photo-affordance-contract: PASS');
