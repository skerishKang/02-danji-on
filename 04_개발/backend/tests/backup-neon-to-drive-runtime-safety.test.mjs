// Issue #797 (parent #714) — HERMETIC RUNTIME SAFETY HARNESS for the Production
// Neon -> Google Drive backup script.
//
// The existing backup-neon-to-drive-contract.mjs is a SOURCE-PATTERN contract. This
// file EXECUTES the real 04_개발/backend/scripts/backup-neon-to-drive.sh control flow
// with mock `docker`, `gpg`, `rclone` and `shred` commands.
//
// Hermetic guarantees: no network, no real database, no real Google Drive, no real
// secret material. Mock commands only append to a trace file inside a temp sandbox.
//
// Mock injection uses two layers so the harness behaves identically on Linux CI and on a
// Git-for-Windows bash:
//   1. executable shims in a sandbox bin directory placed first on PATH
//   2. shell functions sourced from a mock library, exported with `export -f`, which
//      shadow PATH lookup even when the host bash force-prepends /usr/bin
// Both layers delegate to the single shared implementation in the mock library.
//
// The production script is never copied or re-implemented for the success path; only the
// mutation-proof case uses a deliberately weakened temp copy to show this harness bites.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const scriptPath = join(here, '..', 'scripts', 'backup-neon-to-drive.sh');
const scriptSource = readFileSync(scriptPath, 'utf8');

const DB_URL_SENTINEL = 'postgres://SENTINEL_DB_URL_user:SENTINEL_DB_URL_password@sentinel.invalid/danjion';
const PASSPHRASE_SENTINEL = 'SENTINEL_BACKUP_PASSPHRASE_VALUE';
const RCLONE_CONFIG_SENTINEL = '[danjion_backup]\ntype = drive\nscope = drive\nSENTINEL_RCLONE_CONFIG_EXTRA = yes\n';
const FOLDER_ID_SENTINEL = 'SENTINEL_DRIVE_FOLDER_ID_VALUE';
const GITHUB_SHA_SENTINEL = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

const GENERATION_TS = [];
for (let i = 0; i < 33; i += 1) {
  GENERATION_TS.push(`202601${String(i + 1).padStart(2, '0')}T000000Z`);
}
const VALID_BACKUP_NAMES = GENERATION_TS.map((ts, i) => `danjion-prod-${ts}-${String(i).padStart(12, '0')}.dump.gpg`);
const UNRELATED_NAMES = ['readme.txt', 'photo.jpg', 'danjion-backup-notes.txt'];
const MALFORMED_NAMES = [
  'danjion-prod-latest.dump.gpg',
  'danjion-prod-20260101T000000Z-aaaaaaaaaaaa.dump',
  'danjion-prod-20260101T000000Z-aaaaaaaaaaaa.dump.gpg.bak',
  'danjion-prod-20260101T000000Z-aaaaaaaaaaa.dump.gpg',
  'xdanjion-prod-20260101T000000Z-aaaaaaaaaaaa.dump.gpg',
  'DANJION-PROD-20260101T000000Z-aaaaaaaaaaaa.dump.gpg',
];
const ALL_INVENTORY = [...VALID_BACKUP_NAMES, ...UNRELATED_NAMES, ...MALFORMED_NAMES];
const NEWEST_30 = [...VALID_BACKUP_NAMES].sort().reverse().slice(0, 30);
const EXPECTED_OLDEST_3 = [...VALID_BACKUP_NAMES].sort().reverse().slice(30);

// Single shared mock implementation, sourced as shell functions and also used by the
// executable shims. Value-taking flags are parsed explicitly so `--config` can never be
// mistaken for the rclone subcommand. Built as a line array so no JS interpolation can
// ever rewrite the bash source.
const MOCK_LIB = [
  '#!/usr/bin/env bash',
  '_mock_trace() { printf \'%s\\n\' "$1" >> "${DANJION_MOCK_TRACE:?}"; }',
  '_mock_redact() {',
  '  local s="$1"',
  '  s="${s//${DANJION_DRIVE_FOLDER_ID}/<REDACTED_FOLDER_ID>}"',
  '  s="${s//${DANJION_PRODUCTION_DB_URL}/<REDACTED_DB_URL>}"',
  '  s="${s//${DANJION_BACKUP_ENCRYPTION_PASSPHRASE}/<REDACTED_PASSPHRASE>}"',
  '  printf \'%s\' "$s"',
  '}',
  '',
  '_mock_flag() {',
  '  case "$1" in',
  '    --config|--drive-root-folder-id|--format) return 0 ;;',
  '    *) return 1 ;;',
  '  esac',
  '}',
  '',
  'docker() {',
  '  _mock_trace "EVENT|docker|argv=$(_mock_redact "$*")"',
  '  _mock_trace "EVENT|docker|PGOPTIONS=${PGOPTIONS:-}"',
  '  if [ -n "${DATABASE_URL:-}" ]; then _mock_trace "EVENT|docker|DATABASE_URL_ENV=present"; else _mock_trace "EVENT|docker|DATABASE_URL_ENV=absent"; fi',
  '  case "$*" in',
  '    *"${DANJION_PRODUCTION_DB_URL}"*) _mock_trace "EVENT|docker|DBURL_IN_ARGV=yes" ;;',
  '    *) _mock_trace "EVENT|docker|DBURL_IN_ARGV=no" ;;',
  '  esac',
  '  if [ "${DANJION_MOCK_FAIL_DOCKER:-}" = "1" ]; then _mock_trace "EVENT|docker|exit=1"; return 1; fi',
  '  local hostdir="" a',
  '  for a in "$@"; do',
  '    case "$a" in *:/backup) hostdir="${a%:/backup}" ;; esac',
  '  done',
  '  if [ -z "$hostdir" ]; then _mock_trace "EVENT|docker|error=no_mount"; return 1; fi',
  '  local out="${hostdir}/danjion.dump"',
  '  if [ "${DANJION_MOCK_EMPTY_DUMP:-}" = "1" ]; then : > "$out"; else printf \'MOCK_PLAINTEXT_DUMP\' > "$out"; fi',
  '  _mock_trace "EVENT|docker|wrote=${out}"',
  '  return 0',
  '}',
  '',
  'gpg() {',
  '  _mock_trace "EVENT|gpg|argv=$(_mock_redact "$*")"',
  '  local payload',
  '  payload="$(cat)"',
  '  if [ "$payload" = "${DANJION_BACKUP_ENCRYPTION_PASSPHRASE}" ]; then _mock_trace "EVENT|gpg|stdin_passphrase=MATCH"; else _mock_trace "EVENT|gpg|stdin_passphrase=MISMATCH"; fi',
  '  case "$*" in',
  '    *"${DANJION_BACKUP_ENCRYPTION_PASSPHRASE}"*) _mock_trace "EVENT|gpg|PASSPHRASE_IN_ARGV=yes" ;;',
  '    *) _mock_trace "EVENT|gpg|PASSPHRASE_IN_ARGV=no" ;;',
  '  esac',
  '  if [ "${DANJION_MOCK_FAIL_GPG:-}" = "1" ]; then _mock_trace "EVENT|gpg|exit=2"; return 2; fi',
  '  local out="" prev="" a',
  '  for a in "$@"; do',
  '    if [ "$prev" = "--output" ]; then out="$a"; fi',
  '    prev="$a"',
  '  done',
  '  if [ -z "$out" ]; then _mock_trace "EVENT|gpg|error=no_output"; return 2; fi',
  '  if [ "${DANJION_MOCK_EMPTY_GPG:-}" = "1" ]; then : > "$out"; else printf \'MOCK_ENCRYPTED\' > "$out"; fi',
  '  _mock_trace "EVENT|gpg|wrote=${out}"',
  '  return 0',
  '}',
  '',
  'rclone() {',
  '  local cfg="" sub="" prev="" a',
  '  local pos=()',
  '  for a in "$@"; do',
  '    if [ -n "$prev" ]; then',
  '      if [ "$prev" = "--config" ]; then cfg="$a"; fi',
  '      prev=""',
  '      continue',
  '    fi',
  '    if _mock_flag "$a"; then prev="$a"; continue; fi',
  '    case "$a" in',
  '      -*) continue ;;',
  '      *) if [ -z "$sub" ]; then sub="$a"; else pos+=("$a"); fi ;;',
  '    esac',
  '  done',
  '  _mock_trace "EVENT|rclone|sub=${sub}"',
  '  _mock_trace "EVENT|rclone|argv=$(_mock_redact "$*")"',
  '  case "$*" in',
  '    *"${DANJION_DRIVE_FOLDER_ID}"*) _mock_trace "EVENT|rclone|drive_root_folder_id_present=yes" ;;',
  '    *) _mock_trace "EVENT|rclone|drive_root_folder_id_present=no" ;;',
  '  esac',
  '  if [ -n "$cfg" ]; then',
  '    local d',
  '    d="$(dirname "$cfg")"',
  '    if [ -f "$cfg" ]; then _mock_trace "EVENT|rclone|config_materialized=yes"; else _mock_trace "EVENT|rclone|config_materialized=no"; fi',
  '    if [ -e "${d}/danjion.dump" ]; then _mock_trace "EVENT|rclone|PLAINTEXT_PRESENT=yes"; else _mock_trace "EVENT|rclone|PLAINTEXT_PRESENT=no"; fi',
  '  fi',
  '  case "$sub" in',
  '    copyto)',
  '      local src="${pos[0]:-}"',
  '      case "$src" in',
  '        *.dump.gpg) _mock_trace "EVENT|rclone|upload_source=encrypted" ;;',
  '        *) _mock_trace "EVENT|rclone|upload_source=NON_ENCRYPTED" ;;',
  '      esac',
  '      if [ "${DANJION_MOCK_FAIL_UPLOAD:-}" = "1" ]; then _mock_trace "EVENT|rclone|upload=FAIL"; return 1; fi',
  '      _mock_trace "EVENT|rclone|upload=OK"',
  '      return 0 ;;',
  '    lsf)',
  '      if [ "${DANJION_MOCK_FAIL_LSF:-}" = "1" ]; then _mock_trace "EVENT|rclone|lsf=FAIL"; return 1; fi',
  '      _mock_trace "EVENT|rclone|lsf=OK"',
  '      if [ -f "${DANJION_MOCK_INVENTORY:-}" ]; then cat "${DANJION_MOCK_INVENTORY}"; fi',
  '      return 0 ;;',
  '    deletefile)',
  '      local name="${pos[0]:-}"',
  '      name="${name#danjion_backup:}"',
  '      _mock_trace "EVENT|rclone|delete=${name}"',
  '      if [ "${DANJION_MOCK_FAIL_DELETE:-}" = "1" ]; then _mock_trace "EVENT|rclone|delete=FAIL"; return 1; fi',
  '      _mock_trace "EVENT|rclone|delete=OK"',
  '      return 0 ;;',
  '  esac',
  '  _mock_trace "EVENT|rclone|error=unknown_subcommand"',
  '  return 0',
  '}',
  '',
  'shred() {',
  '  _mock_trace "EVENT|shred|argv=$(_mock_redact "$*")"',
  '  if [ "${DANJION_MOCK_FAIL_SHRED:-}" = "1" ]; then _mock_trace "EVENT|shred|exit=1"; return 1; fi',
  '  local a',
  '  for a in "$@"; do',
  '    case "$a" in',
  '      -*) ;;',
  '      *) if [ -f "$a" ]; then rm -f "$a"; fi ;;',
  '    esac',
  '  done',
  '  _mock_trace "EVENT|shred|destroyed"',
  '  return 0',
  '}',
  ''
].join('\n');

function resolveBash() {
  if (process.platform !== 'win32') return 'bash';
  const candidates = [];
  try {
    const execPath = execFileSync('git', ['--exec-path'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const marker = /[\\/]mingw64[\\/]libexec[\\/]git-core$/i;
    if (marker.test(execPath)) {
      const gitRoot = execPath.replace(marker, '');
      candidates.push(join(gitRoot, 'bin', 'bash.exe'), join(gitRoot, 'usr', 'bin', 'bash.exe'));
    }
  } catch { /* git not resolvable */ }
  try {
    const where = execFileSync('where', ['bash'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
    for (const p of where) if (!/\\Windows\\System32\\/i.test(p)) candidates.push(p);
  } catch { /* no bash on PATH */ }
  return candidates.find((p) => p && existsSync(p)) ?? null;
}

const bashPath = resolveBash();
const toBashPath = (p) => p.replace(/\\/g, '/');

function buildSandbox() {
  const root = mkdtempSync(join(tmpdir(), 'danjion-backup-rt-'));
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const libPath = join(root, 'mock-lib.sh');
  writeFileSync(libPath, MOCK_LIB);
  for (const tool of ['docker', 'gpg', 'rclone', 'shred']) {
    const shim = join(bin, tool);
    writeFileSync(shim, `#!/usr/bin/env bash\nsource "\${DANJION_MOCK_LIB}"\n${tool} "$@"\n`);
    try { chmodSync(shim, 0o755); } catch { /* windows no-op */ }
  }
  const wrapper = join(root, 'run-backup.sh');
  writeFileSync(wrapper, [
    '#!/usr/bin/env bash',
    'set -uo pipefail',
    'source "${DANJION_MOCK_LIB}"',
    'export -f _mock_trace _mock_flag _mock_redact docker gpg rclone shred',
    'exec bash "${DANJION_REAL_SCRIPT}"',
    ''
  ].join('\n'));
  return { root, bin, libPath, wrapper };
}

function parseTrace(traceText) {
  return traceText.split(/\r?\n/).filter(Boolean).map((line) => {
    const parts = line.split('|');
    return { raw: line, tool: parts[1] ?? '', detail: parts.slice(2).join('|') };
  });
}

function runScenario(name, options = {}) {
  const sandbox = buildSandbox();
  const tracePath = join(sandbox.root, 'trace.log');
  writeFileSync(tracePath, '');
  const inventoryPath = join(sandbox.root, 'inventory.txt');
  writeFileSync(inventoryPath, `${(options.inventory ?? []).join('\n')}\n`);

  const env = {
    ...process.env,
    PATH: `${sandbox.bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`,
    DANJION_PRODUCTION_DB_URL: DB_URL_SENTINEL,
    DANJION_BACKUP_ENCRYPTION_PASSPHRASE: PASSPHRASE_SENTINEL,
    DANJION_DRIVE_RCLONE_CONFIG: options.rcloneConfig ?? RCLONE_CONFIG_SENTINEL,
    DANJION_DRIVE_FOLDER_ID: FOLDER_ID_SENTINEL,
    GITHUB_SHA: GITHUB_SHA_SENTINEL,
    DANJION_MOCK_TRACE: toBashPath(tracePath),
    DANJION_MOCK_INVENTORY: toBashPath(inventoryPath),
    DANJION_MOCK_LIB: toBashPath(sandbox.libPath),
    DANJION_REAL_SCRIPT: toBashPath(options.scriptPath ?? scriptPath),
  };
  for (const key of ['DANJION_MOCK_FAIL_DOCKER', 'DANJION_MOCK_EMPTY_DUMP', 'DANJION_MOCK_FAIL_GPG',
    'DANJION_MOCK_EMPTY_GPG', 'DANJION_MOCK_FAIL_UPLOAD', 'DANJION_MOCK_FAIL_LSF',
    'DANJION_MOCK_FAIL_DELETE', 'DANJION_MOCK_FAIL_SHRED']) {
    if (options.flags?.[key]) env[key] = options.flags[key];
  }

  const result = spawnSync(bashPath, [toBashPath(sandbox.wrapper)], {
    encoding: 'utf8',
    env,
    cwd: repoRoot,
    timeout: 120000,
  });
  const traceText = readFileSync(tracePath, 'utf8');
  const events = parseTrace(traceText);
  const combined = `${result.stdout ?? ''}${result.stderr ?? ''}${traceText}`;

  const dumpDir = (() => {
    const src = events.find((e) => (e.tool === 'gpg' || e.tool === 'docker') && e.detail.startsWith('wrote='));
    if (!src) return null;
    return dirname(src.detail.replace(/^wrote=/, ''));
  })();

  return {
    name,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    traceText,
    combined,
    events,
    sandboxRoot: sandbox.root,
    tempDir: dumpDir,
  };
}

const has = (run, tool, detail) => run.events.some((e) => e.tool === tool && e.detail === detail);
const firstIndexOf = (run, predicate) => run.events.findIndex(predicate);
const deleteNames = (run) => run.events
  .filter((e) => e.tool === 'rclone' && e.detail.startsWith('delete=') && e.detail !== 'delete=OK' && e.detail !== 'delete=FAIL')
  .map((e) => e.detail.replace(/^delete=/, ''));
const uploadOkCount = (run) => run.events.filter((e) => e.detail === 'upload=OK').length;

function assertNoSecretLeak(run) {
  for (const [label, value] of [
    ['DB_URL', DB_URL_SENTINEL],
    ['PASSPHRASE', PASSPHRASE_SENTINEL],
    ['FOLDER_ID', FOLDER_ID_SENTINEL],
    ['RCLONE_CONFIG', 'SENTINEL_RCLONE_CONFIG_EXTRA'],
  ]) {
    assert.equal(run.combined.includes(value), false, `${label} sentinel value leaked (case ${run.name})`);
  }
}

if (!bashPath) {
  process.stdout.write('RUNTIME_HARNESS=SKIPPED_NO_BASH\n');
  process.stdout.write('backup-neon-to-drive-runtime-safety: SKIPPED (no non-WSL bash available on this host)\n');
  process.exit(0);
}

// The production script must also stay syntactically valid under the very interpreter that
// runs this harness (Git-for-Windows bash locally, ubuntu bash in CI).
const syntax = spawnSync(bashPath, ['-n', toBashPath(scriptPath)], { encoding: 'utf8' });
assert.equal(syntax.status, 0, `backup shell syntax invalid: ${syntax.stderr || syntax.stdout}`);

const cleanups = [];
try {
  /* ---------------- 1. SUCCESS PATH PROOF ---------------- */
  const ok = runScenario('success', { inventory: ALL_INVENTORY });
  cleanups.push(ok.sandboxRoot);
  if (process.env.DANJION_DEBUG_TRACE === '1') {
    process.stdout.write(ok.events.map((e) => e.raw).join('\n') + '\n--- end trace ---\n');
  }
  assert.equal(ok.status, 0, `success path must exit 0: ${ok.stderr}`);
  assert.ok(ok.stdout.includes('BACKUP_RESULT=PASS'), 'success path must report BACKUP_RESULT=PASS');

  const plaintextCreated = firstIndexOf(ok, (e) => e.tool === 'docker' && e.detail.startsWith('wrote='));
  const encryptedCreated = firstIndexOf(ok, (e) => e.tool === 'gpg' && e.detail.startsWith('wrote='));
  const plaintextDestroyed = firstIndexOf(ok, (e) => e.tool === 'shred' && e.detail === 'destroyed');
  const firstDriveCall = firstIndexOf(ok, (e) => e.tool === 'rclone');
  const uploadOk = firstIndexOf(ok, (e) => e.tool === 'rclone' && e.detail === 'upload=OK');
  const retentionListed = firstIndexOf(ok, (e) => e.tool === 'rclone' && e.detail === 'lsf=OK');

  assert.ok(plaintextCreated >= 0, 'plaintext dump must be created');
  assert.ok(encryptedCreated >= 0, 'encrypted dump must be created');
  assert.ok(plaintextDestroyed >= 0, 'plaintext must be destroyed');
  assert.ok(plaintextCreated < encryptedCreated, 'PLAINTEXT_BEFORE_ENCRYPTED');
  assert.ok(encryptedCreated < plaintextDestroyed, 'ENCRYPTED_BEFORE_PLAINTEXT_DESTROYED');
  assert.ok(plaintextDestroyed < firstDriveCall, 'PLAINTEXT_DESTROYED_BEFORE_DRIVE_AUTH=YES');
  assert.ok(plaintextDestroyed < uploadOk, 'PLAINTEXT_DESTROYED_BEFORE_UPLOAD');
  assert.ok(uploadOk < retentionListed, 'UPLOAD_BEFORE_RETENTION');

  assert.ok(has(ok, 'rclone', 'config_materialized=yes'), 'Drive credential config must be materialized');
  assert.equal(ok.events.some((e) => e.detail === 'PLAINTEXT_PRESENT=yes'), false, 'plaintext must be absent at every Drive call');
  assert.ok(ok.events.some((e) => e.detail === 'PLAINTEXT_PRESENT=no'), 'plaintext absence must be observed at Drive time');

  const uploadSources = ok.events.filter((e) => e.detail.startsWith('upload_source=')).map((e) => e.detail);
  assert.deepEqual(uploadSources, ['upload_source=encrypted'], 'ENCRYPTED_UPLOAD=1');
  assert.equal(uploadOkCount(ok), 1, 'PLAINTEXT_UPLOAD=0 / exactly one encrypted upload');
  assert.equal(ok.tempDir && existsSync(ok.tempDir), false, 'temp material must be cleaned up after the run');
  assertNoSecretLeak(ok);

  /* ---------------- 2. DB READ-ONLY / ARGV SAFETY ---------------- */
  assert.ok(has(ok, 'docker', 'PGOPTIONS=-c default_transaction_read_only=on'), 'READ_ONLY_SESSION=YES');
  assert.ok(has(ok, 'docker', 'DATABASE_URL_ENV=present'), 'DB URL must be inherited via environment');
  assert.ok(has(ok, 'docker', 'DBURL_IN_ARGV=no'), 'DATABASE_URL_IN_ARGV=0');
  assert.ok(has(ok, 'gpg', 'stdin_passphrase=MATCH'), 'passphrase must arrive on stdin');
  assert.ok(has(ok, 'gpg', 'PASSPHRASE_IN_ARGV=no'), 'passphrase must never be a process argument');

  /* ---------------- 3. RETENTION SAFETY ---------------- */
  const deleted = deleteNames(ok);
  assert.equal(deleted.length, 3, 'retention must delete exactly the excess beyond 30 generations');
  assert.deepEqual([...deleted].sort(), [...EXPECTED_OLDEST_3].sort(), 'retention must delete only the oldest valid generations');
  for (const name of deleted) {
    assert.match(name, /^danjion-prod-[0-9]{8}T[0-9]{6}Z-[0-9a-fA-F]{12}\.dump\.gpg$/, 'deleted name must match the strict guard');
    assert.ok(!UNRELATED_NAMES.includes(name), 'UNRELATED_FILE_DELETE=0');
    assert.ok(!MALFORMED_NAMES.includes(name), 'MALFORMED_BACKUP_DELETE=0');
    assert.ok(!NEWEST_30.includes(name), 'LATEST_30_DELETE=0');
  }

  /* ---------------- 4. FAILURE INJECTION MATRIX ---------------- */
  const matrix = [];
  const record = (id, run) => {
    matrix.push({ id, exit: run.status, uploads: uploadOkCount(run), deletes: deleteNames(run).length });
    cleanups.push(run.sandboxRoot);
  };

  // A. pg_dump failure
  const caseA = runScenario('A-pg_dump_failure', { inventory: ALL_INVENTORY, flags: { DANJION_MOCK_FAIL_DOCKER: '1' } });
  record('A_pg_dump_failure', caseA);
  assert.notEqual(caseA.status, 0, 'A: pg_dump failure must fail the script');
  assert.equal(uploadOkCount(caseA), 0, 'A: no upload on pg_dump failure');
  assert.equal(deleteNames(caseA).length, 0, 'A: no delete on pg_dump failure');
  assert.equal(has(caseA, 'shred', 'destroyed'), false, 'A: no plaintext ever existed');
  assertNoSecretLeak(caseA);

  // B. empty pg_dump
  const caseB = runScenario('B-empty_pg_dump', { inventory: ALL_INVENTORY, flags: { DANJION_MOCK_EMPTY_DUMP: '1' } });
  record('B_empty_pg_dump', caseB);
  assert.equal(caseB.status, 1, 'B: empty dump must exit 1');
  assert.ok(caseB.stdout.includes('BACKUP_RESULT=FAIL'), 'B: empty dump must report FAIL');
  assert.equal(uploadOkCount(caseB), 0, 'B: no upload on empty dump');
  assert.ok(has(caseB, 'shred', 'destroyed'), 'B: temp plaintext must be cleaned up');
  assertNoSecretLeak(caseB);

  // C. encryption failure
  const caseC = runScenario('C-encryption_failure', { inventory: ALL_INVENTORY, flags: { DANJION_MOCK_FAIL_GPG: '1' } });
  record('C_encryption_failure', caseC);
  assert.notEqual(caseC.status, 0, 'C: encryption failure must fail the script');
  assert.equal(uploadOkCount(caseC), 0, 'C: no upload on encryption failure');
  assert.ok(has(caseC, 'shred', 'destroyed'), 'C: trap cleanup must destroy the plaintext');
  assertNoSecretLeak(caseC);

  // D. empty encrypted output
  const caseD = runScenario('D-empty_encrypted', { inventory: ALL_INVENTORY, flags: { DANJION_MOCK_EMPTY_GPG: '1' } });
  record('D_empty_encrypted_output', caseD);
  assert.equal(caseD.status, 1, 'D: empty encrypted output must exit 1');
  assert.ok(caseD.stdout.includes('BACKUP_RESULT=FAIL'), 'D: empty encrypted output must report FAIL');
  assert.equal(uploadOkCount(caseD), 0, 'D: no upload on empty encrypted output');
  assertNoSecretLeak(caseD);

  // E. invalid rclone remote section
  const caseE = runScenario('E-rclone_section', { inventory: ALL_INVENTORY, rcloneConfig: 'type = drive\nSENTINEL_RCLONE_CONFIG_EXTRA = yes\n' });
  record('E_invalid_rclone_section', caseE);
  assert.equal(caseE.status, 1, 'E: missing remote section must exit 1');
  assert.equal(caseE.events.filter((e) => e.tool === 'rclone').length, 0, 'E: rclone must never run with an invalid remote section');
  assertNoSecretLeak(caseE);

  // F. invalid rclone type
  const caseF = runScenario('F-rclone_type', { inventory: ALL_INVENTORY, rcloneConfig: '[danjion_backup]\ntype = s3\nSENTINEL_RCLONE_CONFIG_EXTRA = yes\n' });
  record('F_invalid_rclone_type', caseF);
  assert.equal(caseF.status, 1, 'F: non-drive remote type must exit 1');
  assert.equal(caseF.events.filter((e) => e.tool === 'rclone').length, 0, 'F: rclone must never run with a non-drive remote type');
  assertNoSecretLeak(caseF);

  // G. upload failure
  const caseG = runScenario('G-upload_failure', { inventory: ALL_INVENTORY, flags: { DANJION_MOCK_FAIL_UPLOAD: '1' } });
  record('G_upload_failure', caseG);
  assert.notEqual(caseG.status, 0, 'G: upload failure must fail the script');
  assert.equal(deleteNames(caseG).length, 0, 'G: retention must not run after a failed upload');
  assert.ok(has(caseG, 'shred', 'destroyed'), 'G: plaintext must already be destroyed');
  assertNoSecretLeak(caseG);

  // H. retention listing failure
  const caseH = runScenario('H-retention_listing_failure', { inventory: ALL_INVENTORY, flags: { DANJION_MOCK_FAIL_LSF: '1' } });
  record('H_retention_listing_failure', caseH);
  // Safety invariants that must hold in EVERY disposition of this case.
  assert.ok(has(caseH, 'rclone', 'lsf=FAIL'), 'H: the listing failure must be observable in the trace');
  assert.equal(uploadOkCount(caseH), 1, 'H: the pre-listing upload is expected to have completed');
  assert.equal(deleteNames(caseH).length, 0, 'H: a failed listing must never delete anything');
  assert.equal(caseH.events.some((e) => e.detail === 'upload_source=NON_ENCRYPTED'), false, 'H: plaintext upload must stay 0');
  assertNoSecretLeak(caseH);
  // Disposition is MEASURED, never pinned to the current defect. If the production script is
  // later repaired to fail closed on a retention listing failure, this flips to YES with no
  // harness change, so no defect-pinning assertion (such as status === 0) may be added here.
  const retentionListingFailClosed = caseH.status !== 0 && caseH.stdout.includes('BACKUP_RESULT=FAIL');

  // I. retention delete failure
  const caseI = runScenario('I-retention_delete_failure', { inventory: ALL_INVENTORY, flags: { DANJION_MOCK_FAIL_DELETE: '1' } });
  record('I_retention_delete_failure', caseI);
  assert.notEqual(caseI.status, 0, 'I: a failed retention delete must fail the script');
  assert.equal(deleteNames(caseI).length, 1, 'I: the failing delete is attempted exactly once before aborting');

  /* ---------------- 5. MUTATION PROOF ---------------- */
  const mutatedDir = mkdtempSync(join(tmpdir(), 'danjion-backup-mut-'));
  cleanups.push(mutatedDir);
  const mutatedPath = join(mutatedDir, 'backup-neon-to-drive.sh');
  const weakened = scriptSource.replace(
    "grep -E '^danjion-prod-[0-9]{8}T[0-9]{6}Z-[0-9a-fA-F]{12}\\.dump\\.gpg$'",
    "grep -E '^danjion-prod-'"
  );
  assert.notEqual(weakened, scriptSource, 'mutation must actually change the retention guard');
  writeFileSync(mutatedPath, weakened);
  const mutated = runScenario('mutation-weakened-guard', { inventory: ALL_INVENTORY, scriptPath: mutatedPath });
  cleanups.push(mutated.sandboxRoot);
  const unsafeDeletes = deleteNames(mutated).filter((n) => UNRELATED_NAMES.includes(n) || MALFORMED_NAMES.includes(n));

  /* ---------------- REPORT ---------------- */
  process.stdout.write('SCRIPT_SYNTAX=bash-n PASS\n');
  process.stdout.write(`BACKUP_RUNTIME_SAFETY_TRACE=${ok.events.length}events\n`);
  process.stdout.write('SUCCESS_PATH=PASS\n');
  process.stdout.write('PLAINTEXT_DESTROYED_BEFORE_DRIVE_AUTH=YES\n');
  process.stdout.write('PLAINTEXT_UPLOAD=0\n');
  process.stdout.write('ENCRYPTED_UPLOAD=1\n');
  process.stdout.write('RETENTION_GENERATIONS=30\n');
  process.stdout.write(`RETENTION_DELETED=${deleted.length}\n`);
  process.stdout.write('UNRELATED_FILE_DELETE=0\n');
  process.stdout.write('MALFORMED_BACKUP_DELETE=0\n');
  process.stdout.write('LATEST_30_DELETE=0\n');
  process.stdout.write('SECRET_VALUE_LOG_LEAK=0\n');
  process.stdout.write('DATABASE_URL_IN_ARGV=0\n');
  process.stdout.write('READ_ONLY_SESSION=YES\n');
  for (const row of matrix) {
    process.stdout.write(`FAILURE_CASE=${row.id} exit=${row.exit} uploads=${row.uploads} deletes=${row.deletes}\n`);
  }
  process.stdout.write('FAILURE_CASE_H_LISTING_EXIT=' + caseH.status + '\n');
  process.stdout.write('RETENTION_LISTING_FAIL_CLOSED=' + (retentionListingFailClosed ? 'YES' : 'NO') + '\n');
  process.stdout.write('BACKUP_ACTIVATION_READINESS=' + (retentionListingFailClosed ? 'NOT_BLOCKED_BY_RETENTION_LISTING' : 'BLOCKED_RETENTION_LISTING') + '\n');
  process.stdout.write(`MUTATION_PROOF=weakened-guard-unsafe-deletes=${unsafeDeletes.length}\n`);
  process.stdout.write('STATIC_CONTRACT=separate(backup-neon-to-drive-contract.mjs)\n');
  process.stdout.write('RUNTIME_HARNESS=PASS\n');

  assert.ok(
    unsafeDeletes.length > 0,
    'MUTATION_PROOF: weakening the retention guard must cause an unsafe delete that this harness detects'
  );
} finally {
  for (const dir of cleanups) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
