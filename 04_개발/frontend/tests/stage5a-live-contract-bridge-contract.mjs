import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Stage 5-A live-contract bridge normalization test (#278).
// Runs the REAL mapApiBusiness/filter logic extracted from the sibling final v3
// discovery file against synthetic fixtures mirroring the production API shape.

const root = new URL('../../../', import.meta.url);
const html = await readFile(new URL('frontend/01_이웃가게_발견_v3.html', root), 'utf8');

// --- extract the real bridge pieces from the file -------------------------
const RELATION_LABEL_SRC = html.match(/const RELATION_LABEL=\{[^}]*\}/)?.[0];
const CATEGORY_BY_SLUG_SRC = html.match(/const CATEGORY_BY_SLUG=\{[^}]*\}/)?.[0];
const MAP_SRC = html.match(/function mapApiBusiness\(b,i\)\{[\s\S]*?\n \}/)?.[0];
const FILTERED_SRC = html.match(/function filtered\(\)\{return SHOP_DATA\.filter\([\s\S]*?\)\)\}/)?.[0];

assert.ok(RELATION_LABEL_SRC, 'bridge must keep a RELATION_LABEL map');
assert.ok(CATEGORY_BY_SLUG_SRC, 'bridge must keep a CATEGORY_BY_SLUG map');
assert.ok(MAP_SRC, 'mapApiBusiness must exist in the v3 discovery runtime');
assert.ok(FILTERED_SRC, 'filtered() must exist in the v3 discovery runtime');

// snake_case acceptance + camel fallback in the real source
assert.match(MAP_SRC, /b\.relation_type\?\?b\.relationType/, 'mapper must accept relation_type with camel fallback');
assert.match(MAP_SRC, /b\.active_benefit\?\?b\.activeBenefit/, 'mapper must accept active_benefit with camel fallback');
assert.match(MAP_SRC, /b\.category_slug\?\?b\.categorySlug/, 'mapper must accept category_slug with camel fallback');
assert.match(MAP_SRC, /b\.price_text\?\?b\.priceText/, 'mapper must accept price_text with camel fallback');
assert.match(MAP_SRC, /b\.service_area\?\?b\.serviceArea/, 'mapper must accept service_area with camel fallback');
assert.match(MAP_SRC, /b\.representative_image_object_key\?\?b\.representativeImageObjectKey/,
  'mapper must accept representative_image_object_key with camel fallback');
assert.match(MAP_SRC, /benefit\.value\|\|benefit\.conditions/, 'benefit.value must be consumed before conditions fallback');
assert.match(MAP_SRC, /benefit\.code/, 'benefit.code must be consumed');
assert.match(MAP_SRC, /Array\.isArray\(b\.categories\)/, 'categories[] must be consumed when present');
// multi-category filtering in the real filtered() logic
assert.match(FILTERED_SRC, /Array\.isArray\(s\.categories\)&&s\.categories\.includes\(currentFilter\)/,
  'filter must match ANY category of the multi-category array');

// --- run the extracted functions against fixtures ---------------------------
const ctx = {};
const factory = new Function(`
  ${RELATION_LABEL_SRC};
  ${CATEGORY_BY_SLUG_SRC};
  ${MAP_SRC};
  ${FILTERED_SRC.replace(/currentFilter/g, 'globalThis.__filter').replace(/query/g, 'globalThis.__query')};
  globalThis.__mapApiBusiness = mapApiBusiness;
  globalThis.__filtered = filtered;
  globalThis.SHOP_DATA = [];
  globalThis.RELATION_LABEL = RELATION_LABEL;
  globalThis.CATEGORY_BY_SLUG = CATEGORY_BY_SLUG;
`);
factory.call(ctx);

const map = (b, i) => globalThis.__mapApiBusiness(b, i);
let currentFilterValue = 'all';
Object.defineProperty(globalThis, '__filter', { get: () => currentFilterValue });
Object.defineProperty(globalThis, '__query', { get: () => '' });

const matchFilter = (shop, filter) => {
  currentFilterValue = filter;
  globalThis.SHOP_DATA = [shop];
  return globalThis.__filtered().length === 1;
};

// A. resident + categories ["food","cafe"] (florist live shape)
{
  const r = map({ id: 'florist', name: '로드힐 꽃작업실', relation_type: 'resident',
    category_slug: 'food', categories: ['food', 'cafe'],
    active_benefit: { title: '꽃다발 예약 상담 시 주민 전용 혜택', value: '예약혜택', code: 'DANJION · F052' } }, 0);
  assert.equal(r.relation, '우리 주민 가게', 'A: resident must map to 우리 주민 가게');
  assert.ok(matchFilter(r, 'food'), 'A: 식품·반찬 filter must match florist');
  assert.ok(matchFilter(r, 'cafe'), 'A: 카페·간식 filter must match florist');
  assert.equal(r.category, 'food', 'A: primary category stays category_slug (food)');
  assert.deepEqual(r.categories, ['food', 'cafe'], 'A: categories[] preserved verbatim');
}

// B. resident_family + ["home"]
{
  const r = map({ id: 'care', name: '온케어 홈서비스', relation_type: 'resident_family',
    category_slug: 'home', categories: ['home'], active_benefit: { value: '면제', code: 'DANJION · H001' } }, 0);
  assert.equal(r.relation, '주민 가족 가게', 'B: resident_family must map to 주민 가족 가게');
  assert.ok(matchFilter(r, 'home'), 'B: 생활서비스 filter must match');
}

// C. neighbor + ["home","car"] (auto repair live shape)
{
  const r = map({ id: 'car', name: '우리동네 자동차정비', relation_type: 'neighbor',
    category_slug: 'car', categories: ['home', 'car'],
    active_benefit: { value: '공임할인', code: 'DANJION · C014' } }, 0);
  assert.equal(r.relation, '이웃단지 가게', 'C: neighbor must map to 이웃단지 가게');
  assert.ok(matchFilter(r, 'home'), 'C: 생활서비스 filter must match car+home business');
  assert.ok(matchFilter(r, 'car'), 'C: 자동차 filter must match car+home business');
  assert.equal(r.category, 'car', 'C: primary category stays category_slug (car)');
  assert.deepEqual(r.categories, ['home', 'car'], 'C: categories[] order preserved (no reorder)');
}

// D. active_benefit value/code preserved
{
  const r = map({ id: 'food', name: '오늘의 반찬', relation_type: 'resident',
    category_slug: 'food', categories: ['food'],
    active_benefit: { title: '방림명지로드힐 주민 10% 할인', value: '10%', code: 'DANJION · F010' } }, 0);
  assert.equal(r.value, '10%', 'D: benefit value must map verbatim');
  assert.equal(r.code, 'DANJION · F010', 'D: benefit code must map verbatim');
  assert.equal(r.benefit, '방림명지로드힐 주민 10% 할인', 'D: benefit title preserved');
}

// E. legacy fixture: no categories[], only category_slug
{
  const r = map({ id: 'legacy', name: '옛 가게', relation_type: 'resident', category_slug: 'pro' }, 0);
  assert.deepEqual(r.categories, ['pro'], 'E: missing categories[] falls back to primary slug');
  assert.ok(matchFilter(r, 'pro'), 'E: legacy row still filterable');
  const camel = map({ id: 'legacy2', relationType: 'resident', categorySlug: 'learn', activeBenefit: { conditions: '조건' } }, 0);
  assert.equal(camel.relation, '우리 주민 가게', 'E: camelCase-only fixture still maps relation');
  assert.equal(camel.category, 'learn', 'E: camelCase-only fixture still maps category');
  assert.deepEqual(camel.categories, ['learn'], 'E: camel fallback yields single-category array');
  assert.equal(camel.value, '조건', 'E: value falls back to conditions when API value absent');
}

// F. unknown relation keeps the safe fallback (no crash, no label invention)
{
  const r = map({ id: 'x', name: '미지 가게', relation_type: 'alien', category_slug: 'food' }, 0);
  assert.equal(r.relation, '이웃단지 가게', 'F: unknown relation_type retains safe fallback');
}

// F2. static fallback integrity: SHOP_DATA copy is untouched by this patch
// (verified separately by byte-parity vs main; here assert the live rows keep
//  the same visible semantics the fallback uses).
assert.equal(globalThis.RELATION_LABEL.resident, '우리 주민 가게');
assert.equal(globalThis.RELATION_LABEL.resident_family, '주민 가족 가게');
assert.equal(globalThis.RELATION_LABEL.neighbor, '이웃단지 가게');

console.log('PASS #278 stage5a live-contract bridge normalization');
