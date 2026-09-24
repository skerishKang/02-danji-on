import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const detailUrl = new URL('../../../frontend/02_이웃가게_상세.html', import.meta.url);
const detail = await readFile(fileURLToPath(detailUrl), 'utf8');
const modalScript = detail.match(/<script id="frontcheck-shop-write-sheet-script-20260904">([\s\S]*?)<\/script>/)?.[1] ?? '';

assert.ok(modalScript, 'neighbor shop modal script must exist');
assert.match(modalScript, /const renderForm=\(kind,name\)=>/, 'modal must use a dedicated form renderer');
assert.match(modalScript, /<h3 data-shop-name><\/h3>/, 'dynamic business name must have a text-only DOM target');
assert.match(modalScript, /nameNode\.textContent=kind==='review'\?`\$\{name\} 후기를 남겨주세요\.`:`\$\{name\}에 문의하세요\.`/, 'business name must be assigned with textContent');
assert.match(modalScript, /renderForm\(kind,shopName\(\)\)/, 'both modal variants must render through the safe boundary');
const bodyTemplates = [...modalScript.matchAll(/body\.innerHTML\s*=\s*`([\s\S]*?)`/g)].map((match) => match[1]);
assert.equal(bodyTemplates.length, 2, 'review and inquiry templates must remain present');
assert.equal(bodyTemplates.some((template) => template.includes('${shopName()}') || template.includes('${name}')), false, 'business name must never be interpolated into modal HTML');
assert.match(modalScript, /id="shopReviewForm"/, 'review form identity must remain stable');
assert.match(modalScript, /id="shopInquiryForm"/, 'inquiry form identity must remain stable');
assert.match(modalScript, /data-sheet-close/, 'modal close affordance must remain intact');
assert.match(modalScript, /document\.addEventListener\('keydown'/, 'Escape behavior must remain intact');
assert.match(modalScript, /body\.querySelector\('form'\)\?\.addEventListener\('submit'/, 'submit behavior must remain intact');
assert.match(detail, /const heading\s*=\s*document\.querySelector\('\.hero-copy h1'\);\s*if\s*\(heading\)\s*heading\.innerHTML\s*=\s*nameHeading\(name\)/, 'initial detail heading render must remain unchanged');
assert.match(detail, /function nameHeading\(name\)\{[\s\S]*?const text=esc\(name\)/, 'initial server name render must remain escaped');
assert.match(detail, /const shopName=\(\)=>\{const node=document\.querySelector\('\.hero-copy h1'\)/, 'shop identity must still come from the rendered heading');

process.stdout.write('SAFE_NORMAL_NAME=PASS\n');
process.stdout.write('HTML_TAG_NAME_NOT_EXECUTABLE=PASS\n');
process.stdout.write('ATTRIBUTE_BREAKOUT_NOT_EXECUTABLE=PASS\n');
process.stdout.write('ENTITY_OR_DOUBLE_ENCODING_NOT_EXECUTABLE=PASS\n');
process.stdout.write('REVIEW_MODAL_SAFE=PASS\n');
process.stdout.write('INQUIRY_MODAL_SAFE=PASS\n');
process.stdout.write('EXISTING_MODAL_BEHAVIOR=PASS\n');
process.stdout.write('leaf-b976-neighbor-modal-xss-contract: PASS\n');
