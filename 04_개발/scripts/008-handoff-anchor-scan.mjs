#!/usr/bin/env node
/**
 * 008 핸드오프 인벤토리 + 앵커 추출 + 기존 16종 패리티 계약 stale 검사 (Read-Only).
 *
 * 사용법:
 *   node 04_개발/scripts/008-handoff-anchor-scan.mjs [--handoff <008폴더>] [--out <json>]
 *
 * 산출:
 *   - 화면별 UI 앵커(타이틀/제목/버튼/라벨/placeholder/data 훅/안정 클래스/상태 변형)
 *   - CONTRACT_SCREEN_MAP 기준 계약별 한국어 앵커의 핸드오프 존재 여부
 *   - missing(전 폴더에도 없음) / relocated(매핑 외 파일에 있음) 판정
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : fallback;
}

const REPO = resolve(import.meta.dirname, '..', '..');
const HANDOFF = arg('handoff', join(REPO, '008_프론트엔드점검1기_통합수정본_20260904'));
const OUT = arg('out', join(REPO, '04_개발', 'docs', 'v2', '008_anchor_scan.json'));
const CONTRACTS_DIR = join(REPO, '04_개발', 'frontend', 'tests');

// 계약 파일 → 대조 대상 핸드오프 화면 파일 (번호 접두)
const CONTRACT_SCREEN_MAP = {
  'v2-current-shell-contract.mjs': ['18_', '04_', 'app.html', 'index.html'],
  'v2-current-home-contract.mjs': ['04_'],
  'v2-current-shops-contract.mjs': ['01_', '02_'],
  'v2-current-complex-hub-contract.mjs': ['05_', '06_', '07_', '08_', '09_'],
  'v2-current-resident-news-contract.mjs': ['10_', '11_'],
  'v2-current-neighbor-conversation-contract.mjs': ['12_', '13_', '14_', '15_', '16_', '17_'],
  'v2-current-settings-contract.mjs': ['24_'],
  'v2-current-notifications-contract.mjs': ['27_'],
  'v2-current-inquiries-contract.mjs': ['25_'],
  'v2-current-activity-contract.mjs': ['28_'],
  'v2-current-household-contract.mjs': ['26_'],
  'v2-current-registration-contract.mjs': ['25A_'],
  'v2-current-summary-contract.mjs': ['19_'],
  'v2-current-messages-contract.mjs': ['20_'],
  'v2-current-conversation-contract.mjs': ['21_'],
  'v2-current-profile-contract.mjs': ['22_'],
};

const HANGUL = /[\u3131-\uD79D]/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const files = walk(HANDOFF);
const htmls = files.filter((f) => f.endsWith('.html'));
const htmlText = new Map();
for (const f of htmls) htmlText.set(basename(f), readFileSync(f, 'utf8'));

/* ---------- 4.4 UI 앵커 추출 ---------- */
function extractAnchors(name, src) {
  const strip = (s) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const pick = (re) => [...src.matchAll(re)].map((m) => strip(m[1])).filter((t) => t && HANGUL.test(t));
  const attr = (re) => [...src.matchAll(re)].map((m) => m[1].trim()).filter((t) => t && HANGUL.test(t));
  const states = {};
  for (const [k, re] of Object.entries({
    empty: /빈\s*상태|아직\s*(없음| 없습니다)|표시할\s*(내용|목록)/g,
    loading: /로딩|불러오는\s*중|spinner/g,
    error: /오류|실패했습니다|다시\s*시도/g,
    successToast: /성공|완료되었습니다|토스트|toast/g,
  })) states[k] = re.test(src) && (re.lastIndex = 0, [...src.matchAll(re)].length) > 0;
  return {
    file: name,
    title: pick(/<title[^>]*>([\s\S]*?)<\/title>/gi)[0] ?? null,
    headings: [...pick(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].slice(0, 40),
    buttons: [...new Set(pick(/<button[^>]*>([\s\S]*?)<\/button>/gi))].slice(0, 60),
    links: [...new Set(pick(/<a\s[^>]*>([\s\S]*?)<\/a>/gi))].filter((t) => t.length <= 24).slice(0, 60),
    labels: [...new Set(attr(/<label[^>]*>([\s\S]*?)<\/label>/gi))].slice(0, 40),
    placeholders: [...new Set(attr(/placeholder="([^"]*)"/g))],
    dataHooks: [...new Set([...src.matchAll(/data-[a-zA-Z0-9-]+/g)].map((m) => m[0]))].slice(0, 60),
    stableClasses: [...new Set([...src.matchAll(/(?:v2|danjion)-[a-zA-Z0-9-]+/g)].map((m) => m[0]))].slice(0, 80),
    states,
  };
}
const anchors = Object.fromEntries(htmls.map((f) => {
  const name = basename(f);
  return [name, extractAnchors(name, htmlText.get(name))];
}));

/* ---------- 4.5 계약 한국어 어설션 추출 ---------- */
function contractKoreanStrings(src) {
  const found = new Set();
  // 1) 따옴표 리터럴
  for (const m of src.matchAll(/'([^'\n]*[\u3131-\uD79D][^'\n]*)'/g)) found.add(m[1]);
  for (const m of src.matchAll(/"([^"\n]*[\u3131-\uD79D][^"\n]*)"/g)) found.add(m[1]);
  // 2) 정규식 리터럴 본문
  for (const m of src.matchAll(/\/([^/\n]*[\u3131-\uD79D][^/\n]*)\/[gimsuy]*/g)) found.add(m[1]);
  // 3) 백틱 템플릿
  for (const m of src.matchAll(/`([^`\n]*[\u3131-\uD79D][^`\n]*)`/g)) found.add(m[1]);
  return [...found].map((raw) => ({
    raw,
    // 정규식 메타문자 정리 후 한국어 연속 코어 추출
    core: raw
      .replace(/\\s\+/g, ' ')
      .replace(/\\[.*+?^${}()|[\]\\]/g, (c) => c[1])
      .replace(/\s+/g, ' ')
      .trim(),
  }));
}

const normalized = new Map();
const norm = (s) => s.replace(/\s+/g, '');
for (const [name, text] of htmlText) normalized.set(name, norm(text));
const normAll = norm([...htmlText.values()].join('')) + norm(readFileSync(join(HANDOFF, 'assets', 'consistency.css'), 'utf8') + readFileSync(join(HANDOFF, 'assets', 'consistency.js'), 'utf8'));

const contractResults = {};
for (const [contract, prefixes] of Object.entries(CONTRACT_SCREEN_MAP)) {
  const src = readFileSync(join(CONTRACTS_DIR, contract), 'utf8');
  const strings = contractKoreanStrings(src);
  const mappedFiles = [...htmlText.keys()].filter((f) => prefixes.some((p) => f.startsWith(p)));
  const mappedNorm = mappedFiles.map((f) => normalized.get(f)).join('');
  const checks = strings.map(({ raw, core }) => {
    const hit = core.length > 1 && norm(core).length > 1 ? norm(core).length : 0;
    const inMapped = hit > 0 && mappedNorm.includes(norm(core));
    const inFolder = hit > 0 ? normAll.includes(norm(core)) : false;
    return { anchor: raw, status: !hit ? 'SKIP' : inMapped ? 'OK' : inFolder ? 'RELOCATED' : 'MISSING' };
  });
  contractResults[contract] = {
    mappedFiles,
    total: checks.length,
    missing: checks.filter((c) => c.status === 'MISSING').map((c) => c.anchor),
    relocated: checks.filter((c) => c.status === 'RELOCATED').map((c) => c.anchor),
    ok: checks.filter((c) => c.status === 'OK').length,
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  handoff: HANDOFF,
  htmlFileCount: htmls.length,
  anchors,
  contracts: contractResults,
};
writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');

/* ---------- 콘솔 요약 ---------- */
console.log(`anchor scan → ${OUT}`);
console.log(`HTML ${htmls.length}개 앵커 추출 완료`);
for (const [contract, r] of Object.entries(contractResults)) {
  const flag = r.missing.length || r.relocated.length ? '⚠' : '✓';
  console.log(`${flag} ${contract}: OK=${r.ok}/${r.total} MISSING=${r.missing.length} RELOCATED=${r.relocated.length}`);
  for (const m of r.missing) console.log(`    MISSING: ${m}`);
  for (const m of r.relocated) console.log(`    RELOCATED: ${m}`);
}
