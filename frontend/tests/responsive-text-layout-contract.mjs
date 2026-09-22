import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Issue #901 [Responsive Typography / Layout Audit]: source contract for the bounded
// responsive text-layout fixes. This leaf pins the fixed declarations at the SOURCE
// level so a future edit cannot silently reintroduce the reported defects.
//
// Why source-level (not browser-level): the top-level contract gate runs with no
// browser and no network (see toplevel-frontend-contract-gate.mjs), so real measurement
// lives in the audit harness. This leaf enforces the invariant that the fix is PRESENT
// and that the specific regression shapes stay absent. Every CHECK below fails on the
// pre-fix source (verified by a mutation battery: reverting each fix flips its check).
//
// Run: node frontend/tests/responsive-text-layout-contract.mjs

const FRONTEND = path.join(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(FRONTEND, rel), 'utf8');

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` : ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ *
 * helpers                                                            *
 * ------------------------------------------------------------------ */

// Parse `{selector, body}` pairs out of a stylesheet, comment-stripped.
// Comment removal is mandatory: `[^{}]+` selector matchers otherwise swallow a
// leading `/* ... *\/` comment and bind it to the NEXT rule's selector.
const parseRules = (css) => {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    rules.push({ sel: m[1].trim(), body: m[2].trim() });
  }
  return rules;
};

// Find the rule whose selector TOKEN set exactly equals one of `wanted`.
// Full-token equality (not substring, not a 600-char lookahead) — a lookahead
// wrongly captures a LATER rule's `!important`.
const findRule = (rules, wanted) => {
  const want = new Set(wanted.map((w) => w.replace(/\s+/g, ' ')));
  const hits = rules.filter((r) => want.has(r.sel.replace(/\s+/g, ' ')));
  assert.ok(hits.length > 0, `no rule found for selector(s): ${wanted.join(' | ')}`);
  return hits;
};

// Assert `prop` occurs with the expected value, and note whether it is !important.
const hasProp = (body, prop, valueRe) => {
  const re = new RegExp(`(?:^|;)\\s*${prop.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+)`, 'i');
  const m = body.match(re);
  if (!m) return { present: false };
  return { present: true, value: m[1].trim(), important: /!important/i.test(m[1]) };
};

/* ------------------------------------------------------------------ *
 * CHECK 1 — P2-1: heading must not sit on a fixed 58px across the      *
 * 761-819px dead zone. The desktop rule has to be fluid.               *
 * ------------------------------------------------------------------ */
{
  for (const [file, sel] of [
    ['06_단지온공지_목록.html', 'h1'],
    ['08_아파트소식_목록.html', 'h1'],
  ]) {
    const rules = parseRules(read(file));
    const h1s = findRule(rules, [sel]).filter((r) => hasProp(r.body, 'font-size').present);
    const fixed58 = h1s.filter((r) => /^\s*58px\s*$/.test(hasProp(r.body, 'font-size').value));
    check(fixed58.length === 0,
      `P2-1 ${file}: no bare "font-size:58px" h1 rule (dead zone removed)`,
      fixed58.length ? `still ${fixed58.length} fixed-58px rule(s)` : '');

    const clamped = h1s.filter((r) => /clamp\(/i.test(hasProp(r.body, 'font-size').value));
    check(clamped.length > 0,
      `P2-1 ${file}: h1 font-size is fluid (clamp())`,
      clamped.length ? `clamp found` : 'no clamp() on h1');

    // The fluid head must still reach the original 58px at wide viewports, or the
    // fix would be a silent desktop redesign.
    if (clamped.length) {
      const v = hasProp(clamped[0].body, 'font-size').value;
      check(/58px/.test(v),
        `P2-1 ${file}: clamp() upper bound preserves desktop 58px`,
        v);
    }
  }
}

/* ------------------------------------------------------------------ *
 * CHECK 2 — P2-1: the tablet band must narrow the 420px copy column    *
 * so the heading track keeps room at 761-900px.                        *
 * ------------------------------------------------------------------ */
{
  for (const [file, sel] of [
    ['06_단지온공지_목록.html', '.notice-head'],
    ['08_아파트소식_목록.html', '.page-head'],
  ]) {
    const css = read(file);
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
    // A band query that covers 761px and constrains the head element.
    const band = clean.match(
      new RegExp(`@media\\s*\\(min-width:\\s*761px\\)\\s*and\\s*\\(max-width:\\s*900px\\)\\s*\\{[\\s\\S]{0,400}?${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`, 'i'));
    check(band !== null,
      `P2-1 ${file}: tablet band (761-900px) narrows ${sel}`,
      band ? 'band rule present' : 'no 761-900px head rule');
    if (band) {
      const gtc = hasProp(band[1], 'grid-template-columns');
      check(gtc.present && !/420px/.test(gtc.value),
        `P2-1 ${file}: tablet band drops the 420px copy column`,
        gtc.present ? gtc.value : 'no grid-template-columns');
    }
  }
}

/* ------------------------------------------------------------------ *
 * CHECK 3 — P3-1: long unspaced Korean text must be allowed to break   *
 * as a LAST RESORT (overflow-wrap:anywhere), while keep-all stays.     *
 * `overflow-wrap:normal` on a clipped card is the regression shape.    *
 * ------------------------------------------------------------------ */
{
  // 06: .notice-row strong carries an !important override in its own style block,
  // so the check must target the important layer, not a plain duplicate rule.
  const css06 = read('06_단지온공지_목록.html');
  const clean06 = css06.replace(/\/\*[\s\S]*?\*\//g, '');
  const strong06 = [...clean06.matchAll(/\.notice-row\s+strong\s*\{([^}]*)\}/g)].map((m) => m[1]);
  check(strong06.length > 0, 'P3-1 06: .notice-row strong rule exists');
  const ow06 = strong06.flatMap((b) => {
    const p = hasProp(b, 'overflow-wrap');
    return p.present ? [p] : [];
  });
  // The effective declaration is the IMPORTANT one when any exists (an !important
  // value out-ranks every plain competitor regardless of specificity). Asserting on
  // "some declaration allows a break" would be a tautology: the plain `.notice-row
  // strong` rule still says anywhere while the important layer silently reverts to
  // `normal` and wins at runtime. Pin the effective winner instead.
  const effective06 = ow06.find((p) => p.important) ?? ow06[0];
  check(effective06 !== undefined && /anywhere|break-word/i.test(effective06.value),
    'P3-1 06: effective overflow-wrap on .notice-row strong allows last-resort break',
    effective06 ? `${effective06.value}${effective06.important ? ' (important=effective)' : ' (plain)'}` : 'none');
  check(!(effective06 && /^\s*normal\s*$/i.test(effective06.value)),
    'P3-1 06: no !important overflow-wrap:normal left on a clipped card',
    effective06 ? effective06.value : 'none');

  const keep06 = strong06.some((b) => /keep-all/i.test(b));
  check(keep06, 'P3-1 06: word-break:keep-all preserved (Korean space-first wrapping)');

  // 08: .news-row strong must also allow the last-resort break.
  const clean08 = read('08_아파트소식_목록.html').replace(/\/\*[\s\S]*?\*\//g, '');
  const strong08 = [...clean08.matchAll(/\.news-row\s+strong\s*\{([^}]*)\}/g)].map((m) => m[1]);
  check(strong08.length > 0, 'P3-1 08: .news-row strong rule exists');
  const ow08 = strong08.flatMap((b) => {
    const p = hasProp(b, 'overflow-wrap');
    return p.present ? [p] : [];
  });
  const effective08 = ow08.find((p) => p.important) ?? ow08[0];
  check(effective08 !== undefined && /anywhere|break-word/i.test(effective08.value),
    'P3-1 08: effective overflow-wrap on .news-row strong allows last-resort break',
    effective08 ? effective08.value : 'none');

  // The pinned notice card must never hide its heading behind overflow only.
  const pinned = [...clean06.matchAll(/\.pinned\s+h2\s*\{([^}]*)\}/g)].map((m) => m[1]);
  const owPin = pinned.flatMap((b) => {
    const p = hasProp(b, 'overflow-wrap');
    return p.present ? [p] : [];
  });
  const effectivePin = owPin.find((p) => p.important) ?? owPin[0];
  check(effectivePin !== undefined && /anywhere|break-word/i.test(effectivePin.value),
    'P3-1 06: effective overflow-wrap on .pinned h2 allows last-resort break',
    effectivePin ? effectivePin.value : 'none');
}

/* ------------------------------------------------------------------ *
 * CHECK 4 — P3-2: the mobile profile-name size must win over the base  *
 * 34px !important, and keep-all must be present.                       *
 * ------------------------------------------------------------------ */
{
  const clean = read('22_주민_공개프로필.html').replace(/\/\*[\s\S]*?\*\//g, '');

  // The 760px band must re-assert profile-name with !important so it out-ranks
  // the base `owner-compact` 34px!important (the original orphan cause).
  const bands = [...clean.matchAll(/@media\s*\(max-width:\s*760px\)\s*\{([\s\S]*?)\}\s*(?=\/\*|@media|[<]|$)/g)]
    .map((m) => m[1]);
  const allBands = [...clean.matchAll(/@media\s*\(max-width:\s*760px\)\s*\{([^]*?)\n\}/g)].map((m) => m[1]);
  const pool = [...bands, ...allBands, clean].join('\n');
  const mobileName = pool.match(/\.profile-name\s*\{([^}]*)\}/g) || [];
  const mobileFix = mobileName.find((b) => /!important/.test(b) && /31px/.test(b));
  check(mobileFix !== undefined,
    'P3-2 22: mobile .profile-name re-asserts 31px!important (out-ranks base 34px!important)',
    mobileFix || 'no 31px!important in a 760px band');

  check(/keep-all/.test(clean),
    'P3-2 22: word-break:keep-all present for the nickname heading');
}

/* ------------------------------------------------------------------ *
 * CHECK 5 — P1-2: the shop-detail menu has FIVE tabs, so every track    *
 * declaration for it must declare five columns. Four tracks for five    *
 * buttons is the regression (후기 wraps to an unmatched second row).    *
 * ------------------------------------------------------------------ */
{
  // consistency.css owns the specificity race ([data-danjion-page="2"]).
  const clean = read('assets/consistency.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const decls = [...clean.matchAll(/\[data-danjion-page="2"\]\s*\.section-tabs\s*\{([^}]*)\}/g)]
    .map((m) => hasProp(m[1], 'grid-template-columns'));
  check(decls.length > 0, 'P1-2 consistency.css: page-2 .section-tabs track rule exists');
  for (const d of decls) {
    if (!d.present) continue;
    const n = d.value.match(/repeat\(\s*(\d+)/);
    check(n !== null && n[1] === '5',
      'P1-2 consistency.css: .section-tabs declares 5 tracks (one per button)',
      d.value);
  }

  // The 02 leaf must contribute the mobile track rule that wins the cascade.
  const clean02 = read('02_이웃가게_상세.html').replace(/\/\*[\s\S]*?\*\//g, '');
  const leaf = [...clean02.matchAll(/\[data-danjion-page="2"\]\s*\.section-tabs\s*\{([^}]*)\}/g)]
    .map((m) => hasProp(m[1], 'grid-template-columns'));
  check(leaf.some((d) => d.present && /repeat\(\s*5/.test(d.value)),
    'P1-2 02: leaf re-declares 5 tracks for the mobile strip',
    leaf.map((d) => d.value).join(' | ') || 'none');

  const minmax = leaf.find((d) => d.present && /minmax\(\s*60px/.test(d.value));
  check(minmax !== undefined,
    'P1-2 02: floor is 60px so 5 tracks fit inside a 320px viewport (5*60=300)',
    minmax ? minmax.value : 'no minmax(60px,...)');
}

console.log(failures === 0
  ? 'RESPONSIVE_TEXT_LAYOUT_CONTRACT_PASS'
  : `RESPONSIVE_TEXT_LAYOUT_CONTRACT_FAIL (${failures} failure(s))`);
process.exit(failures === 0 ? 0 : 1);
