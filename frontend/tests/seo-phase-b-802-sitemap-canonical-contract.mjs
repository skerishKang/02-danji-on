import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/*
 * SEO Phase B regression contract (issue #802) — bounded indexable set
 *
 * This file pins two decisions that must never be conflated:
 *
 *   1. Host authority (owner decision 2026-09-21):
 *        CURRENT_CANONICAL_ORIGIN=https://danjion.pages.dev
 *        danjion.padiem.net = FUTURE / DEFERRED
 *   2. Indexable scope, which #802 states narrowly: "공개 랜딩에만 SEO 메타
 *      부여". The public landing is the only surface the Owner has approved for
 *      indexing so far.
 *
 * PUBLIC_PAGES in seo-phase-a-802-contract.mjs is a PRIVACY classification — it
 * says a surface carries no personal member data. That is not the same question
 * as "should a search engine index it", so this contract declares its own
 * INDEXABLE_PAGES and, more importantly, asserts the negative half: every other
 * public surface is still not canonicalised and not in the sitemap. Without
 * those guards an edit that simply looped over PUBLIC_PAGES would silently widen
 * the index while every positive assertion stayed green.
 */

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

const CANONICAL_ORIGIN = 'https://danjion.pages.dev';
const CANONICAL_HOST = 'danjion.pages.dev';
const DEFERRED_HOST = 'danjion.padiem.net';

/*
 * The owner-approved indexable set. Widening it is an owner/indexability
 * decision, not a refactor of this list.
 */
const INDEXABLE_PAGES = ['index.html'];
const INDEXABLE_URLS = [`${CANONICAL_ORIGIN}/`];

/*
 * Query-driven detail templates: one document serving many server-side
 * identities (?shop, ?postId, ?post). A fixed self-canonical on such a file
 * tells every crawler that all of those identities are the same page. 02 is the
 * clearest case — on the canonical Production origin it is a runtime redirect to
 * 01 — so it must stay out until a policy preserves the post/shop identity.
 */
const DETAIL_TEMPLATES = [
  '02_이웃가게_상세.html',
  '07_단지온공지_상세.html',
  '08A_아파트소식_상세.html',
  '11_주민소식_상세.html',
  '13_이웃대화_글상세_댓글.html'
];

/* Write / action screens: no standalone content to index, no owner approval. */
const ACTION_SURFACES = [
  '14_가입인사_글쓰기.html',
  '15_단지이야기_글쓰기.html',
  '16_궁금해요_글쓰기.html',
  '17_같이해요_글쓰기.html',
  '25A_신청제보.html'
];

/*
 * A shared app shell: Phase A classifies it as neither public nor private.
 * Facts, not policy — this file records what today holds and what does not:
 *   - it is excluded from the sitemap by §4 below;
 *   - a sitemap exclusion does not prevent indexing, it only withholds the URL
 *     from a discovery hint a crawler may ignore;
 *   - the document carries no noindex of its own today;
 *   - robots.txt has no Disallow matching it today.
 * So no layer in this repository currently keeps it out of search results.
 * Deciding that is a follow-up owner/crawl-policy call, not something this
 * contract may settle by assertion.
 */
const UNCLASSIFIED_SHELL = '18_공통앱셸.html';
const INTERNAL_VARIANTS = ['index2', 'app2', 'app', '_v2', '_v3', '00_APP_390', '00_주민혜택_AB비교'];

/*
 * The indexable surfaces are declared above, but the privacy inventories are
 * still read from Phase A so the two files cannot disagree about what is a
 * private member surface. Slicing without a split() limit: JS's second argument
 * caps the returned array length, so `split(needle, 1)[1]` is always undefined.
 */
const phaseA = await read('tests/seo-phase-a-802-contract.mjs');
const listOf = (decl) => {
  const tail = phaseA.split(decl)[1];
  assert.ok(tail, `Phase A contract must keep the ${decl} declaration`);
  return [...tail.split('];')[0].matchAll(/'([^']+\.html)'/g)].map((m) => m[1]);
};
const publicPages = listOf('const PUBLIC_PAGES = [');
const privatePages = listOf('const PRIVATE_PAGES = [');
assert.ok(publicPages.length >= 20 && privatePages.length >= 10,
  'Phase A privacy inventories must stay parseable');
assert.ok(INDEXABLE_PAGES.length < publicPages.length,
  'the indexable set must stay narrower than the privacy classification');

/* A Korean route name in either URL spelling, so no entry dodges a blocklist. */
const stem = (page) => encodeURI(page.replace(/\.html$/i, '')).replace(/'/g, '%27');
const bothForms = (page) => [page.replace(/\.html$/i, ''), page];

const canonicalTags = (html) => [...html.matchAll(/<link[^>]*rel=["']canonical["'][^>]*>/gi)];

/* ---------- 1. the landing carries the one approved canonical ---------- */
{
  assert.deepEqual(INDEXABLE_PAGES, ['index.html'],
    'Phase B scope is the landing only until the Owner widens it');
  const html = await read('index.html');
  const tags = canonicalTags(html);
  assert.equal(tags.length, 1, 'the landing must carry exactly one canonical link');
  const href = /href=["']([^"']+)["']/.exec(tags[0][0])[1];
  assert.equal(href, `${CANONICAL_ORIGIN}/`,
    'the landing canonical must be the origin root on the current public origin');
  assert.ok(html.slice(0, html.indexOf('</head>')).includes('rel="canonical"'),
    'the landing canonical must live in <head>');
  assert.doesNotMatch(html, /<link[^>]*rel=["']canonical["'][^>]*href=["'][^"']*\.html["']/i,
    'a canonical must name the final URL; Pages answers /index.html with a 308 to /');

  const hosts = [...html.matchAll(/https?:\/\/([^/'"`\s<>?#]+)/gi)]
    .map((m) => m[1].toLowerCase().replace(/\.$/, ''));
  assert.deepEqual([...new Set(hosts)], [CANONICAL_HOST],
    'the landing may name only the canonical origin as an absolute URL host');
}

/* ---------- 2. nothing else is canonicalised: PUBLIC does not imply INDEXABLE ---------- */
{
  for (const page of publicPages) {
    if (INDEXABLE_PAGES.includes(page)) continue;
    const html = await read(page);
    assert.equal(canonicalTags(html).length, 0,
      `${page}: no canonical while the indexable set is the landing only —`
      + ' widening it needs an owner/indexability decision, not a loop over PUBLIC_PAGES');
  }
  for (const page of [...DETAIL_TEMPLATES, ...ACTION_SURFACES])
    assert.ok(!INDEXABLE_PAGES.includes(page),
      `${page}: detail templates and action surfaces must stay outside INDEXABLE_PAGES`);
  for (const page of privatePages)
    assert.equal(canonicalTags(await read(page)).length, 0,
      `${page}: a noindexed private surface must not advertise a canonical`);
  for (const page of ['admin/index.html', '404.html'])
    assert.equal(canonicalTags(await read(page)).length, 0, `${page}: must not be canonicalised`);
}

/* ---------- 3. the privacy classification and its noindex authority still hold ---------- */
{
  for (const page of privatePages) {
    const html = await read(page);
    assert.match(html, /<meta\s+name="robots"\s+content="noindex,nofollow"\s*\/?>/,
      `${page}: private surface must stay noindex,nofollow`);
  }
  const admin = await read('admin/index.html');
  assert.match(admin, /<meta name="robots" content="noindex"/, 'admin console must stay noindex');
  const notFound = await read('404.html');
  assert.match(notFound, /<meta name="robots" content="noindex,nofollow">/, '404 must stay noindex');
  for (const page of publicPages) {
    assert.doesNotMatch(await read(page), /<meta[^>]*name=["']robots["'][^>]*noindex/i,
      `${page}: public surface must not be accidentally noindexed`);
  }
}

/* ---------- 4. the sitemap carries exactly the approved indexable set ---------- */
{
  const xml = await read('sitemap.xml');
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/, 'sitemap needs a UTF-8 XML declaration');
  assert.match(xml, /<urlset[^>]*xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/,
    'sitemap must use the sitemaps.org namespace');
  assert.match(xml, /<\/urlset>\s*$/, 'sitemap must close the urlset');

  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual([...locs].sort(), [...INDEXABLE_URLS].sort(),
    'the sitemap must hold exactly the owner-approved indexable URLs, nothing added and nothing dropped');
  assert.equal(new Set(locs).size, locs.length, 'sitemap must not list a URL twice');
  for (const loc of locs) {
    assert.doesNotMatch(loc, /[^\x00-\x7F]/, `sitemap URL must be percent-encoded ASCII: ${loc}`);
    assert.ok(loc.startsWith(`${CANONICAL_ORIGIN}/`),
      `every sitemap URL must be absolute on the canonical origin: ${loc}`);
    assert.doesNotMatch(loc, /\.html$/,
      `a published sitemap URL must be the final clean URL, not the 308-redirecting .html form: ${loc}`);
  }
  assert.ok(locs.includes(`${CANONICAL_ORIGIN}/`), 'the landing is published as the origin root');

  const excluded = [...privatePages, ...DETAIL_TEMPLATES, ...ACTION_SURFACES, UNCLASSIFIED_SHELL];
  for (const page of excluded) {
    for (const form of bothForms(page)) {
      assert.ok(!locs.some((loc) => loc.includes(encodeURI(form).replace(/'/g, '%27'))),
        `sitemap must exclude ${page} (found the ${form} spelling)`);
    }
    assert.ok(!xml.includes(page), `sitemap must not even name the source file ${page} in a URL`);
  }
  for (const token of INTERNAL_VARIANTS)
    assert.ok(!locs.some((loc) => loc.includes(token)),
      `internal review/authoring variants must stay out of the sitemap (found ${token})`);
  assert.ok(!locs.some((loc) => loc.includes('/admin')), 'the admin console must stay out of the sitemap');
  assert.equal(locs.length, INDEXABLE_PAGES.length,
    'the sitemap may list exactly the approved indexable set');
}

/* ---------- 5. robots.txt advertises that sitemap and keeps the host policy ---------- */
{
  const robots = await read('robots.txt');
  assert.match(robots, new RegExp(`^Sitemap: ${CANONICAL_ORIGIN.replace(/\./g, '\\.')}\\/sitemap\\.xml$`, 'm'),
    'robots.txt must carry the sitemap directive on the canonical origin');
  assert.equal([...robots.matchAll(/^Sitemap:/gim)].length, 1, 'robots.txt must declare exactly one sitemap');
  assert.match(robots, /^User-agent: \*/m, 'robots.txt must keep the wildcard user-agent');
  assert.match(robots, /^Allow: \/$/m, 'robots.txt must keep allowing the public landing');
  assert.doesNotMatch(robots, /^\s*Disallow:\s*\/\s*$/im, 'robots.txt must not block the root');
  assert.doesNotMatch(robots, /^\s*Sitemap:.*(padiem|_qa|review|preview)/im,
    'the sitemap directive must point at the current canonical origin only');

  for (const page of privatePages) {
    for (const form of bothForms(page)) {
      assert.ok(!robots.includes(form),
        `robots.txt must not list private surface ${page} — noindex in the head is the authority`);
      assert.ok(!robots.includes(encodeURI(form).replace(/'/g, '%27')),
        `robots.txt must not list private surface ${page} in the percent-encoded spelling either`);
    }
  }
  /*
   * Scope note: these are the internal review/authoring directives, and this
   * asserts they are present. It does not assert they match what a crawler is
   * served: Pages redirects /index2.html to /index2, so a .html Disallow does
   * not cover the clean URL, and non-ASCII paths need percent-encoding to match
   * at all. See the follow-up recorded in the PR body.
   */
  for (const path of ['/admin/', '/index2.html', '/app2.html', '/00_APP_390_통합검토.html'])
    assert.ok(robots.includes(path),
      `robots.txt must keep its internal-only ${path} directive (existence only, see the clean-URL follow-up)`);

  /*
   * Same normalization as the landing scan above: capture the whole host and
   * strip a sentence-final period, so the comparison rejects look-alikes such
   * as danjion.pages.dev.evil.example and any non-canonical host, while prose
   * like "…https://danjion.pages.dev." in the header is not a stray host.
   */
  const hosts = [...robots.matchAll(/https?:\/\/([^/'"`\s<>?#]+)/g)]
    .map((m) => m[1].toLowerCase().replace(/\.$/, ''));
  assert.deepEqual([...new Set(hosts)], [CANONICAL_HOST],
    'robots.txt may name only the canonical origin as an absolute host');
  const directives = robots.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#')).join('\n');
  assert.ok(!directives.includes(DEFERRED_HOST), 'no robots.txt directive may name the deferred domain');
}

/* ---------- 6. future-domain/indexability policy stays in source contracts, not sitemap payload ---------- */
{
  const xml = await read('sitemap.xml');
  const robots = await read('robots.txt');

  assert.ok(!xml.includes(DEFERRED_HOST),
    'the sitemap payload must never name the deferred custom domain');
  assert.ok(!xml.includes(`${CANONICAL_ORIGIN}/index.html`),
    'the sitemap must not publish the redirecting /index.html form');
  assert.doesNotMatch(xml, /<!--[\s\S]*?-->/,
    'the production sitemap stays minimal XML; policy commentary belongs in source contracts/runbooks');

  assert.match(robots, /DEFERRED/,
    'robots.txt must record the custom domain as deferred');
  assert.ok(!robots.includes(`${CANONICAL_ORIGIN}/index.html`),
    'robots.txt must not publish the redirecting /index.html form');
  assert.match(robots, /one bounded follow-up/,
    'robots.txt must keep the rule that a future cutover moves every surface at once');
  assert.match(robots, /canonical[\s\S]{0,240}Search Console/,
    'robots.txt must name the paired surfaces: canonical URL, sitemap and Search Console');
}

console.log(
  `seo-phase-b-802-sitemap-canonical-contract: PASS canonical=${INDEXABLE_PAGES.length} `
  + `sitemap=${INDEXABLE_URLS.length} guarded_public=${publicPages.length - INDEXABLE_PAGES.length} `
  + `private=${privatePages.length} origin=${CANONICAL_ORIGIN}`
);
