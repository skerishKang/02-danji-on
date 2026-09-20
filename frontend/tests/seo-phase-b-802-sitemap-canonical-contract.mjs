import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/*
 * SEO Phase B regression contract (issue #802)
 *
 * Pins the owner decision of 2026-09-21 into the shipped artifacts:
 *
 *   CURRENT_PUBLIC_ORIGIN=https://danjion.pages.dev
 *   danjion.padiem.net    = FUTURE / DEFERRED
 *
 * and the three things Phase B adds on top of Phase A:
 *
 *   1. a self-referential canonical on every indexable public surface
 *   2. frontend/sitemap.xml carrying exactly those surfaces
 *   3. a Sitemap directive in robots.txt
 *
 * The indexable set is not restated here: it is parsed out of the Phase A
 * contract, so the two files cannot drift apart. Private / personalized member
 * surfaces stay out of the sitemap because each one carries noindex,nofollow in
 * its own head — that meta tag remains the authority, and this file asserts it
 * is still there instead of trusting the exclusion.
 */

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

const CANONICAL_ORIGIN = 'https://danjion.pages.dev';
const DEFERRED_HOST = 'danjion.padiem.net';

const phaseA = await read('tests/seo-phase-a-802-contract.mjs');
/*
 * Array literals are sliced without a split() limit: JS's second argument caps
 * the returned array length, so `split(needle, 1)[1]` is always undefined.
 */
const listOf = (decl) => {
  const tail = phaseA.split(decl)[1];
  assert.ok(tail, `Phase A contract must keep the ${decl} declaration`);
  return [...tail.split('];')[0].matchAll(/'([^']+\.html)'/g)].map((m) => m[1]);
};
const publicPages = listOf('const PUBLIC_PAGES = [');
const privatePages = listOf('const PRIVATE_PAGES = [');
assert.ok(publicPages.length > 0 && privatePages.length > 0, 'Phase A inventory must be parseable');

/*
 * Pages serves these static documents at clean URLs and answers the *.html
 * form with a 308 to it (verified live: /08_….html -> 308 -> /08_…, while
 * /08_… alone is 200). A canonical or sitemap entry that names the .html form
 * therefore publishes a URL whose final destination is somewhere else, which
 * is the one thing a canonical must not do. So every published path is built
 * from the extension-less stem, and `stem()` is the single place that decides
 * it — including for exclusions, so an entry cannot dodge a blocklist simply
 * by carrying the redirecting suffix.
 */
const stem = (page) => encodeURI(page.replace(/\.html$/i, '')).replace(/'/g, '%27');
const publicPath = (page) => (page === 'index.html' ? '/' : `/${stem(page)}`);
const publicUrl = (page) => `${CANONICAL_ORIGIN}${publicPath(page)}`;

/* ---------- 1. every indexable surface carries exactly one canonical ---------- */
{
  assert.ok(publicPages.length >= 20, `expected at least 20 indexable surfaces, got ${publicPages.length}`);
  for (const page of publicPages) {
    const html = await read(page);
    const tags = [...html.matchAll(/<link[^>]*rel=["']canonical["'][^>]*>/gi)];
    assert.equal(tags.length, 1, `${page}: must carry exactly one canonical link`);
    assert.ok(tags[0][0].includes(`href="${publicUrl(page)}"`),
      `${page}: canonical must be the self URL on the canonical origin, got ${tags[0][0]}`);
    assert.doesNotMatch(tags[0][0], /href="[^"]*\.html"/,
      `${page}: a canonical must name the final clean URL; Pages 308-redirects the .html form`);
    const head = html.slice(0, html.indexOf('</head>'));
    assert.ok(head.includes('rel="canonical"'), `${page}: canonical must live in <head>`);
  }
}

/* ---------- 2. excluded surfaces keep their own noindex authority ---------- */
{
  for (const page of privatePages) {
    const html = await read(page);
    assert.match(html, /<meta\s+name="robots"\s+content="noindex,nofollow"\s*\/?>/,
      `${page}: private surface must stay noindex,nofollow`);
    assert.doesNotMatch(html, /<link[^>]*rel=["']canonical["']/i,
      `${page}: a noindexed private surface must not advertise a canonical`);
  }
  const admin = await read('admin/index.html');
  assert.match(admin, /<meta name="robots" content="noindex"/, 'admin console must stay noindex');
  assert.doesNotMatch(admin, /<link[^>]*rel=["']canonical["']/i, 'admin console must not be canonicalised');
  const notFound = await read('404.html');
  assert.doesNotMatch(notFound, /<link[^>]*rel=["']canonical["']/i, 'the 404 page must not be canonicalised');
}

/* ---------- 3. sitemap.xml carries exactly the indexable set ---------- */
{
  const xml = await read('sitemap.xml');
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/, 'sitemap needs an XML declaration');
  assert.match(xml, /<urlset[^>]*xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/,
    'sitemap must use the sitemaps.org namespace');
  assert.match(xml, /<\/urlset>\s*$/, 'sitemap must close the urlset');
  /*
   * The ASCII requirement belongs on the published URLs, not on the file: the
   * explanatory header is Korean by design, which is exactly why the
   * declaration above must say UTF-8.
   */
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/, 'sitemap must declare UTF-8');
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g))
    assert.doesNotMatch(m[1], /[^\x00-\x7F]/, `sitemap URL must be percent-encoded ASCII: ${m[1]}`);

  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(new Set(locs).size, locs.length, 'sitemap must not list a URL twice');
  assert.deepEqual([...locs].sort(), publicPages.map(publicUrl).sort(),
    'sitemap set must equal the indexable public set, nothing added and nothing dropped');
  for (const loc of locs) assert.ok(loc.startsWith(`${CANONICAL_ORIGIN}/`),
    `every sitemap URL must be absolute on the canonical origin: ${loc}`);
  for (const loc of locs) assert.doesNotMatch(loc, /\.html$/,
    `a published sitemap URL must be the final clean URL, not the 308-redirecting .html form: ${loc}`);
  assert.ok(locs.includes(`${CANONICAL_ORIGIN}/`), 'the landing must be listed as the origin root');
  for (const page of privatePages)
    assert.ok(!locs.some((loc) => loc.includes(`/${stem(page)}`)),
      `sitemap must exclude private surface ${page}`);
  // 18_공통앱셸.html is a shared app shell: Phase A classifies it as neither public
  // nor private, so it must not be promoted into the index by this change.
  assert.ok(!locs.some((loc) => loc.includes(`/${stem('18_공통앱셸.html')}`)),
    'the unclassified shared app shell must stay out of the sitemap');
  assert.equal(locs.length, publicPages.length,
    'the sitemap may list exactly the Phase A indexable set');
  assert.ok(!locs.some((loc) => /_v2$|_v3$/.test(loc) || loc.endsWith('/index2')),
    'internal review/authoring variants must stay out of the sitemap');
  assert.ok(!locs.some((loc) => loc.includes('/admin')), 'the admin console must stay out of the sitemap');
}

/* ---------- 4. robots.txt advertises the sitemap on the canonical origin ---------- */
{
  const robots = await read('robots.txt');
  assert.match(robots, new RegExp(`^Sitemap: ${CANONICAL_ORIGIN.replace(/\./g, '\\.')}\\/sitemap\\.xml$`, 'm'),
    'robots.txt must carry the sitemap directive on the canonical origin');
  assert.equal([...robots.matchAll(/^Sitemap:/gim)].length, 1, 'robots.txt must declare exactly one sitemap');
  assert.match(robots, /^User-agent: \*/m, 'robots.txt must keep the wildcard user-agent');
  assert.match(robots, /^Allow: \/$/m, 'robots.txt must keep allowing the public landing');
  assert.doesNotMatch(robots, /^\s*Disallow:\s*\/\s*$/im, 'robots.txt must not block the root');
  for (const page of privatePages)
    assert.ok(!robots.includes(page) && !robots.includes(publicPath(page).slice(1)),
      `robots.txt must not list private surface ${page} — noindex in the head is the authority`);
  for (const path of ['/admin/', '/index2.html', '/app2.html', '/00_APP_390_통합검토.html'])
    assert.ok(robots.includes(path),
      `robots.txt must keep its internal-only ${path} directive (see the deferred-pages follow-up note: this asserts the directive exists, not that it matches the clean URL)`);
  const hosts = [...robots.matchAll(/https?:\/\/([^/'"`\s<>?#]+)/g)].map((m) => m[1].toLowerCase().replace(/\.$/, ''));
  assert.deepEqual([...new Set(hosts)], ['danjion.pages.dev'],
    'robots.txt may name only the canonical origin as an absolute host');
}

/* ---------- 5. one origin everywhere, and the deferred host is not published ---------- */
{
  const xml = await read('sitemap.xml');
  const robots = await read('robots.txt');
  /*
   * Scope note: this constrains the machine-readable SEO surfaces — canonical
   * hrefs, the sitemap and the robots directives. It deliberately does not
   * constrain every URL in a document: the demo copy on some pages still links
   * third-party placeholder images, which is a separate content concern from
   * origin authority and is not what Phase B pins.
   */
  for (const page of publicPages) {
    const html = await read(page);
    for (const tag of html.matchAll(/<link[^>]*rel=["']canonical["'][^>]*>/gi)) {
      const href = /href=["']([^"']+)["']/.exec(tag[0])?.[1] ?? '';
      const url = new URL(href);
      assert.equal(url.origin, CANONICAL_ORIGIN, `${page}: canonical href must be the current origin`);
      assert.equal(url.pathname, publicPath(page), `${page}: canonical must be self-referential`);
    }
  }
  assert.ok(xml.includes(`${CANONICAL_ORIGIN}/sitemap.xml`) || robots.includes(`${CANONICAL_ORIGIN}/sitemap.xml`),
    'the sitemap must be reachable on the canonical origin');
  assert.ok(robots.includes(`${CANONICAL_ORIGIN}/sitemap.xml`), 'robots and sitemap must share one origin');

  /*
   * The deferred host may appear in prose comments — that documentation is what
   * stops a future editor from assuming pages.dev is permanent. It must never
   * appear in a machine-readable surface: not in a <loc>, and not in any
   * non-comment robots.txt directive.
   */
  const locText = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).join(' ');
  assert.ok(!locText.includes(DEFERRED_HOST), 'no sitemap URL may name the deferred custom domain');
  assert.ok(!locText.includes('padiem.net'), 'no sitemap URL may name the Padiem domain at all');
  const directives = robots.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#')).join('\n');
  assert.ok(!directives.includes(DEFERRED_HOST),
    'no robots.txt directive may name the deferred custom domain');
  assert.ok(!/^\s*Sitemap:.*(padiem|_qa|review|preview)/im.test(robots),
    'the sitemap directive must point at the current canonical origin only');
}

/* ---------- 6. the deferred domain stays documented as future work ---------- */
{
  const xml = await read('sitemap.xml');
  const robots = await read('robots.txt');
  assert.match(xml, /DEFERRED/, 'the sitemap header must record the custom domain as deferred');
  assert.match(robots, /DEFERRED/, 'robots.txt header must record the custom domain as deferred');
  assert.match(robots, /one bounded follow-up/,
    'robots.txt must keep the rule that a future cutover moves every surface at once');
  assert.match(robots, /canonical[\s\S]{0,200}Search Console/,
    'robots.txt must name the paired surfaces: canonical URLs, sitemap and Search Console');
  assert.match(xml, /must not name it|must not/,
    'the sitemap header must instruct against naming the deferred host');
  const sitemapDirectiveCount = [...xml.matchAll(/<loc>/g)].length;
  assert.ok(sitemapDirectiveCount >= 20,
    `sitemap must publish every indexable surface (found ${sitemapDirectiveCount})`);
}

console.log(
  `seo-phase-b-802-sitemap-canonical-contract: PASS canonical=${publicPages.length} `
  + `excluded_private=${privatePages.length} origin=${CANONICAL_ORIGIN}`
);
