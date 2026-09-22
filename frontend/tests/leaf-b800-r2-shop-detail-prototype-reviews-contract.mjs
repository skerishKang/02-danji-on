import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (relative) => readFile(new URL('../' + relative, import.meta.url), 'utf8');
const readBackend = (relative) => readFile(new URL('../../04_개발/backend/src/' + relative, import.meta.url), 'utf8');

const [detail, bridge, backend] = await Promise.all([
  read('02_이웃가게_상세.html'),
  read('assets/reviews-bridge.js'),
  readBackend('business-reviews-v1.ts')
]);

/* ------------------------------------------------------------------ *
 * #800 R2 — 가게 상세(02)는 프로토타입 후기 시드를 정적으로 렌더하면 안 된다.
 *
 * 이 contract 는 "지워졌다"만 확인하지 않는다. 지웠다고 주장하는 것과
 * 실제로 서버 후기 레인이 그 자리를 대체하는 것은 다른 문제이며,
 * 프로토타입을 다시 붙여 넣는 회귀는 화면을 직접 보지 않으면 놓치기 때문이다.
 * ------------------------------------------------------------------ */

// ── helpers ──────────────────────────────────────────────────────────
// 근접 문자열 탐색(lastIndexOf)으로 요소를 찾으면, 문서 앞쪽에 있는
// 무관한 동일 토큰이 먼저 걸려 실제 검사 대상이 아니게 된다.
// 따라서 태그 open/close 스택을 실제로 걷는 파서를 쓴다.
const VOID_TAGS = new Set(['input', 'br', 'img', 'hr', 'meta', 'link', 'source', 'area', 'base', 'col']);

function enclosingClasses(source, index) {
  // index 위치의 문자를 감싸는 모든 조상 요소의 class 문자열을 안쪽부터 반환.
  const stack = [];
  const tagPattern = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let match;
  while ((match = tagPattern.exec(source)) !== null) {
    const [full, isClose, tag, attrs, selfClose] = match;
    if (match.index >= index) break;
    const name = tag.toLowerCase();
    if (isClose) {
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].name === name) { stack.length = i; break; }
      }
      continue;
    }
    if (selfClose || VOID_TAGS.has(name)) continue;
    const classAttr = /\bclass\s*=\s*"([^"]*)"/.exec(attrs) || /\bclass\s*=\s*'([^']*)'/.exec(attrs);
    stack.push({ name, classes: classAttr ? classAttr[1].trim().split(/\s+/).filter(Boolean) : [] });
  }
  return stack.map((entry) => entry.classes.join(' '));
}

function subtreeOf(source, openTagIndex) {
  // openTagIndex 의 여는 태그부터 짝이 맞는 닫는 태그까지의 원문 슬라이스.
  const head = /<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/.exec(source.slice(openTagIndex));
  if (!head) return null;
  if (head[3] === '/' || VOID_TAGS.has(head[1].toLowerCase())) return head[0];
  const name = head[1];
  const openAll = new RegExp('<' + name + '(?=[\\s/>])', 'gi');
  const closeAll = new RegExp('</' + name + '\\s*>', 'gi');
  openAll.lastIndex = openTagIndex;
  let depth = 0;
  let cursor = openTagIndex;
  while (cursor < source.length) {
    openAll.lastIndex = cursor;
    closeAll.lastIndex = cursor;
    const nextOpen = openAll.exec(source);
    const nextClose = closeAll.exec(source);
    if (!nextClose) return null;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      cursor = nextOpen.index + nextOpen[0].length;
      continue;
    }
    depth -= 1;
    if (depth === 0) return source.slice(openTagIndex, nextClose.index + nextClose[0].length);
    cursor = nextClose.index + nextClose[0].length;
  }
  return null;
}

function elementsWithClass(source, className) {
  // className 을 가진 모든 요소의 서브트리를 수집.
  const found = [];
  const pattern = new RegExp('<(article|div|section|span|p|li)\\b[^>]*\\bclass\\s*=\\s*"[^"]*\\b' + className + '\\b[^"]*"[^>]*>', 'g');
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const subtree = subtreeOf(source, match.index);
    if (subtree) found.push(subtree);
  }
  return found;
}

/* ── 1. 프로토타입 후기 시드가 렌더 마크업에 남아 있지 않다 ─────────── */

const PROTOTYPE_REVIEW_AUTHORS = ['연블리', '산책메이트', '햇살맘', '초록창'];

// 후기 컨테이너 서브트리 안에는 프로토타입 이름이 단 하나도 없어야 한다.
const reviewListIndex = detail.search(/<div\b[^>]*\bclass\s*=\s*"[^"]*\breview-list\b[^"]*"[^>]*>/);
assert.notEqual(reviewListIndex, -1, '02 must keep a review-list container');
const reviewListSubtree = subtreeOf(detail, reviewListIndex);
assert.ok(reviewListSubtree, '02 review-list subtree must be resolvable');
for (const author of PROTOTYPE_REVIEW_AUTHORS) {
  assert.doesNotMatch(
    reviewListSubtree,
    new RegExp(author),
    'review-list must not render prototype author ' + author
  );
  assert.doesNotMatch(
    reviewListSubtree,
    new RegExp(author + '\\s*·'),
    'review-list must not render prototype residency suffix for ' + author
  );
}

// 프로토타입 시절의 4건 고정 구조(정적 review-item 4개)가 남아 있지 않다.
const staticReviewItems = elementsWithClass(reviewListSubtree, 'review-item')
  .filter((subtree) => !/data-server-placeholder/.test(subtree));
assert.equal(
  staticReviewItems.length,
  0,
  'review-list must not ship static review-item markup (found ' + staticReviewItems.length + ')'
);

// 제거된 시드 본문도 흔적을 남기지 않는다.
for (const phrase of ['부모님 생신 꽃다발', '원하는 분위기를 잘 들어주시고', '가격과 가능한 꽃을 먼저 설명', '작은 선물용으로 부탁드렸는데']) {
  assert.doesNotMatch(detail, new RegExp(phrase), 'prototype review body must be removed: ' + phrase);
}

/* ── 2. 서버 후기 레인이 그 자리를 실제로 대체한다 ──────────────────── */

// 브릿지 런타임이 로드되어야 한다.
assert.match(
  detail,
  /<script\s+src="assets\/reviews-bridge\.js"><\/script>/,
  '02 must load the reviews bridge runtime'
);

// 초기 렌더는 서버 로딩 상태(placeholder)여야 한다.
assert.match(
  detail,
  /data-server-placeholder="true"/,
  '02 must render a server-loading placeholder instead of seeded reviews'
);
assert.match(
  reviewListSubtree,
  /data-server-placeholder="true"/,
  'the review-list container itself must ship the placeholder'
);

// 서버 권위 레인: 라이브 와이어링 스크립트가 존재하고 bridge.list 를 호출한다.
const laneIndex = detail.search(/<script\b[^>]*\bid\s*=\s*"danjion-shop-detail-reviews-server-lane"[^>]*>/);
assert.notEqual(laneIndex, -1, '02 must ship the shop-detail reviews server lane');
const laneSubtree = subtreeOf(detail, laneIndex);
assert.ok(laneSubtree, 'server lane script body must be resolvable');

assert.match(laneSubtree, /createReviewsBridge\(/, 'lane must construct the reviews bridge');
assert.match(laneSubtree, /bridge\.list\(|\.list\(key\)/, 'lane must call bridge.list for server reviews');
assert.match(laneSubtree, /result\.mode!=='server'/, 'lane must branch on server mode');
assert.match(laneSubtree, /review\.author\.nickname|author&&review\.author\.nickname/, 'lane must render server author nickname');
assert.match(laneSubtree, /review\.createdAt/, 'lane must render server createdAt');

// 🔴 회귀 함정: 레인을 "정의"만 하고 부팅 시 "호출"하지 않으면 화면은 placeholder
// 에 멈춘 채 프로토타입도 서버 후기도 보여주지 않는다. 정의 존재만 검사하면
// 이 결함은 살아남는다(SURVIVOR). boot trigger 를 별도로 고정한다.
assert.match(
  laneSubtree,
  /^\s*void load\(\);\s*$/m,
  'lane must invoke load() at boot (definition alone leaves the list permanently on placeholder)'
);
// 부팅 호출이 조건문/플래그 뒤에 숨어 실질적으로 실행되지 않는 형태를 배제한다.
assert.doesNotMatch(
  laneSubtree,
  /if\s*\(\s*(?:false|0|null|undefined|'')\s*\)\s*\{?\s*void load\(\)/,
  'lane must not gate the boot load() behind a falsy condition'
);

// 프로토타입이 아닌 이름을 렌더한다는 사실을 고정한다.
assert.doesNotMatch(laneSubtree, /연블리|산책메이트|햇살맘|초록창/, 'lane must not hardcode prototype authors');
assert.match(laneSubtree, /DanjionReviewsBridge/, 'lane must use the shared bridge global');

// API base 는 세션 권위에서 가져온다 (하드코딩 금지).
assert.match(laneSubtree, /DanjionSession\.danjionApiBase\(\)/, 'lane must resolve apiBase from the session authority');

// 레거시 슬러그 키는 서버 조회 없이 안내 문구로 graceful degradation 해야 한다.
assert.match(
  laneSubtree,
  /businessIdFromKey\(key\)/,
  'lane must gate server fetch on a resolvable business id'
);

/* ── 3. 브릿지/백엔드 계약: 서버가 닉네임 권위다 ───────────────────── */

// 브릿지는 api-<uuid> 키만 서버 조회로 승격한다.
assert.match(bridge, /if\(!text\.startsWith\('api-'\)\)return null/, 'bridge must reject non api- keys');
assert.match(bridge, /if\(!businessId\)return \{mode:'static'/, 'bridge must degrade legacy slugs to static mode');
assert.match(bridge, /nickname:\s*String\(author\.nickname\s*\|\|\s*''\)/, 'bridge must normalize server-supplied nickname');

// 백엔드는 app_users.display_name 을 닉네임 권위로 사용한다.
assert.match(backend, /author:\s*\{[\s\S]{0,200}?nickname:\s*String\(row\.author_nickname\)/, 'backend review payload must expose author.nickname from app_users.display_name');
assert.match(backend, /author\.display_name as author_nickname/, 'backend must select display_name as the nickname authority');
assert.match(backend, /join app_users author/, 'backend must resolve author identity from app_users');

console.log('leaf-b800-r2-shop-detail-prototype-reviews-contract: PASS');
