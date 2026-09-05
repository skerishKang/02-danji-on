#!/usr/bin/env node
/**
 * DanjiOn CTO Gate Runner — 로컬 구현 브랜치에 대한 결정적 판정 도구.
 *
 * 역할: 웹 모델(CTO)이 로컬 모델이 푸시한 트랙(F/G) 브랜치를 격리 워크트리에서
 *       뽑아 게이트(타입/계약/빌드/회귀)를 재현 가능하게 통과/실패 판정.
 *
 * 특징:
 *   - 호출자의 실제 작업 트리를 건드리지 않는다 (임시 워크트리 사용).
 *   - 베이스(origin/main)와 대상 브랜치를 각각 실행해 회귀(regression)를 분리한다.
 *   - 실패하면 0이 아닌 exit code를 내보내 CI/gate에 자연스럽게 이어진다.
 *
 * 사용법 예시:
 *   node 04_개발/scripts/cto-gate-runner.mjs --ref origin/feat/track-g-r1-parity-slice --base origin/main
 *
 * 옵션:
 *   --ref <ref>              판정할 브랜치/커밋 (기본 origin/main)
 *   --base <ref>             회귀 비교용 베이스 (기본 origin/main)
 *   --worktree <path>        격리 워크트리 경로 (기본 /tmp/cto-gate-<ts>)
 *   --install                워크트리에서 npm install 실행 (기본 false: 기존 node_modules 사용)
 *   --quick                  베이스 게이트를 건너뛰고 대상만 실행
 *   --keep                   판정 후 워크트리를 삭제하지 않음
 *   --backend-tests <csv>    백엔드에서 추가 실행할 test: 스크립트 이름 (쉼표)
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const REPO = ROOT; // 04_개발/scripts 위 2단계 = 리포 루트

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

const REF = arg('ref', 'origin/main');
const BASE = arg('base', 'origin/main');
const WORKTREE = hasFlag('worktree') ? resolve(arg('worktree')) : null;
const DO_INSTALL = hasFlag('install');
const QUICK = hasFlag('quick');
const KEEP = hasFlag('keep');
const BACKEND_TESTS = (arg('backend-tests', '') || '').split(',').map((s) => s.trim()).filter(Boolean);

function run(cmd, args, cwd, label) {
  const pretty = `${cmd} ${args.join(' ')}`;
  process.stdout.write(`\n[STEP] ${label || pretty}\n`);
  try {
    execFileSync(cmd, args, { cwd, stdio: 'inherit' });
    return true;
  } catch (e) {
    process.stdout.write(`  ✗ FAILED: ${pretty}\n`);
    return false;
  }
}

function gateWorktree() {
  const dir = WORKTREE || mkdtempSync(join(tmpdir(), 'cto-gate-'));
  // detached checkout of REF
  console.log(`\n=== worktree: ${dir} @ ${REF} ===`);
  try {
    execFileSync('git', ['worktree', 'add', '--force', '--detach', dir, REF], { cwd: REPO, stdio: 'inherit' });
  } catch (e) {
    console.error(`worktree add failed for ${REF}: ${e.message}`);
    process.exit(2);
  }
  return dir;
}

function cleanup(dir) {
  if (KEEP) {
    console.log(`\n[keep] worktree retained at ${dir}`);
    return;
  }
  try {
    execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: REPO, stdio: 'inherit' });
    execFileSync('git', ['worktree', 'prune'], { cwd: REPO, stdio: 'inherit' });
  } catch (e) {
    console.warn(`worktree cleanup warning: ${e.message}`);
  }
}

function runBackend(dir) {
  const b = join(dir, '04_개발', 'backend');
  if (!existsSync(join(b, 'node_modules')) && (DO_INSTALL || true)) {
    run('npm', ['install', '--no-audit', '--no-fund'], b, 'backend npm install');
  }
  let ok = run('npm', ['run', 'typecheck'], b, 'backend typecheck');
  for (const t of ['test:contract', ...BACKEND_TESTS]) {
    const r = run('npm', ['run', t], b, `backend ${t}`);
    ok = ok && r;
  }
  return ok;
}

function runFrontend(dir) {
  const f = join(dir, '04_개발', 'frontend');
  if (!existsSync(join(f, 'node_modules')) && (DO_INSTALL || true)) {
    run('npm', ['install', '--no-audit', '--no-fund'], f, 'frontend npm install');
  }
  let ok = run('npm', ['run', 'typecheck'], f, 'frontend typecheck (full parity)');
  ok = run('npm', ['run', 'build'], f, 'frontend build') && ok;
  return ok;
}

function runRef(ref, label) {
  const dir = gateWorktree();
  let ok = true;
  ok = runBackend(dir) && ok;
  ok = runFrontend(dir) && ok;
  console.log(`\n${label} verdict: ${ok ? 'GREEN' : 'FAIL'}`);
  if (!KEEP) cleanup(dir);
  return ok;
}

console.log('DanjiOn CTO Gate Runner');
console.log(`  repo   : ${REPO}`);
console.log(`  target : ${REF}`);
console.log(`  base   : ${BASE}`);
console.log(`  quick  : ${QUICK}`);

let targetOk;
if (QUICK) {
  targetOk = runRef(REF, 'TARGET');
} else {
  const baseOk = runRef(BASE, 'BASE');
  const tOk = runRef(REF, 'TARGET');
  targetOk = tOk;
  if (!baseOk) {
    console.warn('\n⚠ BASE itself is not green; regression attribution is uncertain.');
  }
}

process.exit(targetOk ? 0 : 1);
