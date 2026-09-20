import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/*
 * SEO Phase A regression contract (issue #802)
 *
 * Scope: the SEO work that holds at every stage —
 *
 *   1. the public landing exposes a real title + description + identity
 *   2. the public landing is indexable (never blocked)
 *   3. private / personalized member surfaces are marked noindex
 *   4. no production-facing title ships internal process metadata
 *   5. absolute published URLs use exactly the current canonical origin, and
 *      no other host
 *
 * PHASE B SUPERSESSION (owner decision 2026-09-21, #802 Phase B):
 * Sections 6 and 7 used to assert that a canonical link and a Sitemap
 * directive were ABSENT, because the production domain was not attached yet
 * (#779 / #792). The Owner fixed the current origin as
 * https://danjion.pages.dev and unblocked SEO completion, so those assertions
 * encoded a rule the project no longer runs under. They are now replaced by
 * narrower ones that pin the exact origin and still forbid every other host,
 * which is strictly more checking than before, not less. The
 * canonical/sitemap/robots content itself is asserted by
 * seo-phase-b-802-sitemap-canonical-contract.mjs.
 */

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

const PUBLIC_PAGES = [
  'index.html',
  '01_이웃가게_발견.html',
  '02_이웃가게_상세.html',
  '03_주민혜택_쿠폰.html',
  '04_데일리홈.html',
  '05_우리단지_첫화면.html',
  '06_단지온공지_목록.html',
  '07_단지온공지_상세.html',
  /*
   * 08_아파트소식_목록.html — public apartment-news list. No personal /
   * personalized surface (no ?userId=, publicProfile, nickname, joinedMonth,
   * publicBio). The only personal-ish string is a demo-shell screen route
   * (settings -> 1:1 문의), which is navigation, not resident data.
   * Was excluded earlier only because of the #819 collision guard, which is
   * now released (#819 merged).
   */
  '08_아파트소식_목록.html',
  /*
   * 08A_아파트소식_상세.html — added by #819. It is a public apartment-news
   * article detail: no personal data surface, so it must stay indexable.
   * The only "로그인이 필요" string on the page is the reaction (공감) toast,
   * an interaction gate — not a page-level private surface.
   */
  '08A_아파트소식_상세.html',
  '09_회장인사_상세.html',
  '10_주민소식_목록.html',
  '11_주민소식_상세.html',
  '12_이웃대화_첫화면.html',
  '13_이웃대화_글상세_댓글.html',
  '14_가입인사_글쓰기.html',
  '15_단지이야기_글쓰기.html',
  '16_궁금해요_글쓰기.html',
  '17_같이해요_글쓰기.html',
  '25A_신청제보.html'
];

/*
 * NOTE on 22_주민_공개프로필.html: "공개프로필" means other residents can
 * view it inside the app. It is NOT a policy decision to publish it to
 * search engines — it renders a per-resident surface (?userId=, publicProfile
 * API, nickname, joinedMonth, publicBio, publicActivityCount). Issue #59
 * (Privacy gate) is still OPEN/HOLD, so this surface stays noindex until
 * the privacy policy is settled. App-internal access is unchanged.
 */
const PRIVATE_PAGES = [
  '19_내정보_메인.html',
  '20_메시지함_목록.html',
  '21_메시지_대화상세.html',
  '22_주민_공개프로필.html',
  '23_이웃온기.html',
  '24_설정.html',
  '25_1대1문의.html',
  '26_우리집연결.html',
  '27_알림함.html',
  '28_나의활동.html'
];

const FORBIDDEN_TITLE = /STEP\s*\d+|WEB\s+CINEMATIC|웹\s*통합검토|프론트엔드\s*점검|점검\s*\d+기/i;
const CANONICAL_ORIGIN = 'https://danjion.pages.dev';
const CANONICAL_HOST = 'danjion.pages.dev';

/*
 * Every absolute URL host in a published SEO surface must be exactly the current
 * canonical origin. Comparing whole captured hosts (instead of matching a pattern
 * that merely starts with it) also rejects look-alikes such as
 * https://danjion.pages.dev.evil.example, and a host that is not *.pages.dev at
 * all — including the deferred danjion.padiem.net.
 */
function assertOnlyCanonicalHost(text, label) {
  const hosts = [...text.matchAll(/https?:\/\/([^/'"`\s<>?#]+)/gi)]
    .map((m) => m[1].toLowerCase().replace(/\.$/, ''));
  const stray = [...new Set(hosts)].filter((host) => host !== CANONICAL_HOST);
  assert.deepEqual(stray, [], `${label}: only ${CANONICAL_HOST} may appear as an absolute URL host (found: ${stray.join(', ') || 'none'})`);
}

const titleOf = (html) => {
  const m = [...html.matchAll(/<title>([\s\S]*?)<\/title>/gi)];
  assert.equal(m.length, 1, 'each page needs exactly one <title>');
  return m[0][1].replace(/\s+/g, ' ').trim();
};

const metaContent = (html, name) => {
  const re = new RegExp(
    `<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["']`,
    'i'
  );
  const m = html.match(re);
  return m ? m[1].trim() : null;
};

/* ---------- 1. public landing ---------- */
{
  const landing = await read('index.html');
  const title = titleOf(landing);

  assert.equal(
    title,
    '방림명지로드힐 단지온 | 우리 아파트 주민생활 플랫폼',
    'landing must expose the approved SEO title'
  );
  assert.ok(title.includes('방림명지로드힐'), 'landing title must name the complex');
  assert.ok(title.includes('단지온'), 'landing title must preserve DanjiOn naming');
  assert.ok(title.includes('우리 아파트 주민생활 플랫폼'), 'landing title must state the product identity');

  const description = metaContent(landing, 'description');
  assert.ok(description, 'landing must ship a meta description');
  assert.ok(description.length >= 40, 'landing description must be substantive, not a stub');
  assert.ok(description.length <= 200, 'landing description must stay within a sensible SERP length');
  assert.ok(description.includes('방림명지로드힐'), 'landing description must name the complex');
  assert.ok(
    /이웃가게/.test(description) && /단지소식/.test(description),
    'landing description must describe the offered services'
  );
  assert.ok(/주민혜택/.test(description) && /이웃대화/.test(description),
    'landing description must describe the offered services');
  assert.ok(description.includes('주민생활 플랫폼'), 'landing description must state the product identity');

  /* visible identity for real users, not keyword stuffing */
  assert.ok(landing.includes('방림명지로드힐'), 'landing body must show the complex name');
  assert.ok(landing.includes('우리 아파트 주민생활 플랫폼'), 'landing body must show the product identity');
  const complexHits = (landing.match(/방림명지로드힐/g) || []).length;
  assert.ok(complexHits <= 14, `landing must not keyword-stuff the complex name (found ${complexHits})`);
}

/* ---------- 2. landing is indexable ---------- */
{
  const landing = await read('index.html');
  assert.doesNotMatch(
    landing,
    /<meta[^>]*name=["']robots["'][^>]*noindex/i,
    'the public landing must never be blocked from indexing'
  );
}

/* ---------- 3. private surfaces are noindex ---------- */
for (const page of PRIVATE_PAGES) {
  const html = await read(page);
  assert.match(
    html,
    /<meta\s+name="robots"\s+content="noindex,nofollow"\s*\/?>/,
    `${page}: private member surface must be noindex,nofollow`
  );
}
{
  const admin = await read('admin/index.html');
  assert.match(admin, /<meta name="robots" content="noindex"/, 'admin console must stay noindex');
  const notFound = await read('404.html');
  assert.match(notFound, /<meta name="robots" content="noindex,nofollow">/, '404 must stay noindex');
}

/* ---------- 4. public surfaces are NOT noindex ---------- */
for (const page of PUBLIC_PAGES) {
  const html = await read(page);
  assert.doesNotMatch(
    html,
    /<meta[^>]*name=["']robots["'][^>]*noindex/i,
    `${page}: public surface must not be accidentally noindexed`
  );
}

/* ---------- 5. no production-facing internal process metadata ---------- */
for (const page of [...PUBLIC_PAGES, ...PRIVATE_PAGES, 'index2.html', '00_APP_390_통합검토.html']) {
  const title = titleOf(await read(page));
  assert.ok(title, `${page}: title must be non-empty`);
  assert.doesNotMatch(
    title,
    FORBIDDEN_TITLE,
    `${page}: internal process metadata must not ship in a production-facing title`
  );
}

/* ---------- 6. the landing pins the current canonical origin, and nothing else ---------- */
{
  const landing = await read('index.html');
  assert.match(
    landing,
    new RegExp(`<link[^>]*rel=["']canonical["'][^>]*href=["']${CANONICAL_ORIGIN}/["']`),
    'the landing canonical must point at exactly the current public origin root'
  );
  assertOnlyCanonicalHost(landing, 'index.html');
}

/* ---------- 7. robots.txt is domain-independent and safe ---------- */
{
  const robots = await read('robots.txt');

  assert.match(robots, new RegExp(`^\\s*Sitemap:\\s*${CANONICAL_ORIGIN.replace(/[.]/g, '\\.')}/sitemap\\.xml\\s*$`, 'im'),
    'robots.txt must advertise the sitemap on exactly the current canonical origin');
  assertOnlyCanonicalHost(robots, 'robots.txt');
  assert.doesNotMatch(robots, /^\s*Disallow:\s*\/\s*$/im,
    'robots.txt must not block the public landing root');
  assert.match(robots, /^\s*User-agent:\s*\*/im, 'robots.txt must declare a wildcard user-agent');
  assert.match(robots, /^\s*Allow:\s*\/\s*$/im, 'robots.txt must allow the public landing');

  /*
   * robots.txt is a crawl hint, not an access-control or security boundary.
   * The authority for keeping private surfaces out of search results is the
   * noindex meta tag asserted above. Listing private member routes here
   * would advertise them and would wrongly imply robots.txt protects them.
   * Both spellings are checked: a Korean route name written as raw text and
   * the percent-encoded form a crawler-facing robots.txt would actually use.
   */
  const percentEncoded = (page) => encodeURI(page).replace(/'/g, '%27');
  for (const page of PRIVATE_PAGES) {
    assert.ok(
      !robots.includes(page) && !robots.includes(percentEncoded(page)),
      `robots.txt must not list private surface ${page} (raw or percent-encoded) — noindex in the document head is the authority`
    );
  }

  /* internal-only surfaces may still be disallowed */
  for (const path of ['/admin/', '/index2.html', '/app2.html', '/00_APP_390_통합검토.html']) {
    assert.ok(robots.includes(path), `robots.txt should keep internal-only ${path} out of crawler reach`);
  }
}

/* ---------- 8. resident public profile stays out of search ---------- */
{
  const profile = await read('22_주민_공개프로필.html');
  assert.match(
    profile,
    /<meta\s+name="robots"\s+content="noindex,nofollow"\s*\/?>/,
    '22: resident public profile must not be published to search engines while #59 privacy gate is OPEN'
  );
  /* app-internal access must be untouched */
  assert.ok(
    /userId/.test(profile),
    '22: per-resident ?userId= routing must remain intact (noindex does not remove in-app access)'
  );
}

/* ---------- 9. apartment-news surfaces stay public ---------- */
{
  const list = await read('08_아파트소식_목록.html');
  assert.equal(
    titleOf(list),
    '단지온 · 아파트소식',
    '08: public apartment-news list must keep its service title'
  );
  assert.doesNotMatch(
    list,
    /<meta[^>]*name=["']robots["'][^>]*noindex/i,
    '08: a public apartment-news list must not be noindexed'
  );
  assert.ok(list.includes('rel="canonical" href="https://danjion.pages.dev/08_'),
    '08: the public news list must carry a canonical on the current origin');
  assertOnlyCanonicalHost(list, '08');
  assert.ok(
    !PRIVATE_PAGES.includes('08_아파트소식_목록.html'),
    '08: must never be classified as a private member surface'
  );
}

{
  const article = await read('08A_아파트소식_상세.html');
  assert.equal(
    titleOf(article),
    '단지온 · 아파트소식 상세',
    '08A: public apartment-news article detail must keep its service title'
  );
  assert.doesNotMatch(
    article,
    /<meta[^>]*name=["']robots["'][^>]*noindex/i,
    '08A: a public article detail must not be noindexed'
  );
  assert.ok(article.includes('rel="canonical" href="https://danjion.pages.dev/08A_'),
    '08A: the public article detail must carry a canonical on the current origin');
  assertOnlyCanonicalHost(article, '08A');
  assert.ok(
    !PRIVATE_PAGES.includes('08A_아파트소식_상세.html'),
    '08A: must never be classified as a private member surface'
  );
}

console.log(
  `seo-phase-a-802-contract: PASS public=${PUBLIC_PAGES.length} private=${PRIVATE_PAGES.length}`
);
