import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const workflow = readFileSync(join(repoRoot, '.github', 'workflows', 'backup-neon-to-drive.yml'), 'utf8');
const scriptPath = join(here, '..', 'scripts', 'backup-neon-to-drive.sh');
const script = readFileSync(scriptPath, 'utf8');

if (process.platform !== 'win32') {
  const syntax = spawnSync('bash', ['-n', scriptPath], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, `backup shell syntax invalid: ${syntax.stderr || syntax.stdout}`);
}

// Extracts one step's `run: |` body from the workflow YAML so the activation contract can be
// asserted against the executable gate script rather than the whole file.
function extractStepRunBlock(source, stepName) {
  const lines = source.split(/\r?\n/);
  const nameIdx = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  assert.ok(nameIdx >= 0, `workflow step not found: ${stepName}`);
  let runIdx = -1;
  for (let i = nameIdx + 1; i < lines.length; i += 1) {
    if (/^\s*-\s/.test(lines[i])) break;
    if (/^\s*run:\s*\|\s*$/.test(lines[i])) { runIdx = i; break; }
  }
  assert.ok(runIdx > nameIdx, `run block not found for step: ${stepName}`);
  const runIndent = lines[runIdx].match(/^\s*/)[0].length;
  const body = [];
  for (let i = runIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() !== '' && line.match(/^\s*/)[0].length <= runIndent) break;
    body.push(line);
  }
  const nonEmpty = body.filter((line) => line.trim() !== '');
  const bodyIndent = Math.min(...nonEmpty.map((line) => line.match(/^\s*/)[0].length));
  return body.map((line) => line.slice(bodyIndent)).join('\n').trim();
}

// The value the Production environment variable DANJION_BACKUP_ENABLED must hold. It is not a
// secret; it is a human-auditable switch token. The activation output token must never equal it
// (nor be boolean), otherwise the job output value can collide with a masked secret value and
// the runner silently drops it before downstream `if` conditions are evaluated.
const REQUIRED_ENABLE_SWITCH_VALUE = 'enabled';

assert.match(workflow, /cron:\s*'17 18 \* \* \*'/, 'daily candidate schedule must remain 24h');
assert.match(workflow, /environment:\s*production/, 'PRODUCTION_ENVIRONMENT_PRESERVED=PASS');
assert.match(workflow, /Exact main authority guard/, 'EXACT_MAIN_GUARD_PRESERVED=PASS');
assert.match(workflow, /Reconfirm exact main immediately before backup/, 'exact-main must be rechecked immediately before backup');

/* ---- SCHEDULE_EXACT_MAIN_FIX (#1066) ---- */
const authorityGate = extractStepRunBlock(workflow, 'Exact main authority guard');
const eventBranchPos = authorityGate.indexOf('if [ "${GITHUB_EVENT_NAME}" = "workflow_dispatch" ]');
const resolvedValidationPos = authorityGate.indexOf('if [[ ! "${expected_main}" =~ ^[0-9a-fA-F]{40}$ ]]');
assert.ok(eventBranchPos >= 0, 'manual/schedule event branch must exist');
assert.ok(resolvedValidationPos > eventBranchPos,
  'resolved expected_main must be selected before SHA validation so schedule does not validate an empty dispatch input');
assert.ok(
  authorityGate.includes('expected_main="${EXPECTED_MAIN}"'),
  'workflow_dispatch must still consume explicit expected_main',
);
assert.ok(
  authorityGate.includes('expected_main="${GITHUB_SHA}"'),
  'scheduled runs must derive expected_main from the scheduled source SHA',
);
assert.equal(
  authorityGate.slice(0, eventBranchPos).includes('EXPECTED_MAIN'),
  false,
  'schedule path must not validate workflow_dispatch-only EXPECTED_MAIN before event resolution',
);
assert.ok(
  authorityGate.includes('actual_main="$(git rev-parse origin/main)"'),
  'remote main must still be re-read',
);
assert.ok(
  authorityGate.includes('if [ "${GITHUB_SHA}" != "${expected_main}" ] || [ "${actual_main}" != "${expected_main}" ]; then'),
  'both checked-out source and remote main must equal the resolved expected main',
);

/* ---- ENABLE_SWITCH_CONTEXT_FIX (#714) ---- */
assert.match(
  workflow,
  /DANJION_BACKUP_ENABLED:\s*\$\{\{\s*vars\.DANJION_BACKUP_ENABLED\s*\}\}/,
  'ENABLE_SWITCH_USES_VARS_CONTEXT=PASS',
);
assert.doesNotMatch(workflow, /secrets\.DANJION_BACKUP_ENABLED/, 'ENABLE_SWITCH_DOES_NOT_USE_SECRETS_CONTEXT=PASS');
assert.match(workflow, /DANJION_BACKUP_SOURCE_ARMED:\s*'true'/, 'source arm is owner-authorized (#714); runtime activation still requires the separate non-secret DANJION_BACKUP_ENABLED variable');

/* ---- JOB_OUTPUT_MASKING_FIX (#714) ---- */
assert.match(
  workflow,
  /state:\s*\$\{\{\s*steps\.activation\.outputs\.state\s*\}\}/,
  'JOB_OUTPUT_ACTIVE_DISABLED_PRESENT=PASS',
);
for (const forbidden of [
  /steps\.activation\.outputs\.enabled/,
  /needs\.activation-gate\.outputs\.enabled/,
  /^\s*enabled:\s*\$\{\{\s*steps\.activation/m,
  /echo\s+"enabled=/,
  /\benabled=(?:true|false)\b/,
]) {
  assert.doesNotMatch(workflow, forbidden, `removed boolean job-output plumbing must not return: ${forbidden}`);
}
assert.match(workflow, /needs\.activation-gate\.outputs\.state == 'active'/, 'BACKUP_JOB_IF_ACTIVE=PASS');
assert.match(workflow, /needs\.activation-gate\.outputs\.state != 'active'/, 'DISABLED_JOB_IF_NOT_ACTIVE=PASS');

const activationGate = extractStepRunBlock(workflow, 'Backup activation gate');
assert.match(activationGate, /\[ "\$\{DANJION_BACKUP_SOURCE_ARMED\}" != "true" \]/, 'SOURCE_ARM_REQUIRED=PASS');
assert.match(
  activationGate,
  new RegExp(`\\$\\{DANJION_BACKUP_ENABLED:-\\}" != "${REQUIRED_ENABLE_SWITCH_VALUE}"`),
  'ENABLE_VARIABLE_REQUIRED=PASS',
);
assert.match(activationGate, /DANJION_BACKUP_ENABLED:-/, 'an unset enable variable must fail closed through the :- default, not abort the step');

const emittedTokens = [...activationGate.matchAll(/echo\s+"(state=[^"]*)"\s*>>\s*"\$\{GITHUB_OUTPUT\}"/g)]
  .map((match) => match[1].slice('state='.length));
assert.deepEqual([...emittedTokens].sort(), ['active', 'disabled'], 'activation must emit exactly the active/disabled tokens');
for (const token of emittedTokens) {
  assert.ok(
    !['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'].includes(token.toLowerCase()),
    `ACTIVATION_OUTPUT_TOKEN_NOT_BOOLEAN=PASS violated by token: ${token}`,
  );
  assert.notEqual(token, REQUIRED_ENABLE_SWITCH_VALUE, `ACTIVATION_OUTPUT_TOKEN_NOT_ENABLE_SWITCH_VALUE=PASS violated by token: ${token}`);
  assert.notEqual(token, 'true', 'the source-arm literal must not be reused as an output token');
}

const activationBlock = workflow.split(/\n  encrypted-backup:/)[0];
assert.match(activationBlock, /DANJION_BACKUP_ENABLED/, 'activation job must receive only the non-secret enable switch');
assert.doesNotMatch(activationBlock, /DANJION_PRODUCTION_DB_URL/, 'disabled activation job must not materialize DB URL');
assert.doesNotMatch(activationBlock, /DANJION_BACKUP_ENCRYPTION_PASSPHRASE/, 'disabled activation job must not materialize encryption secret');
assert.doesNotMatch(activationBlock, /DANJION_DRIVE_RCLONE_CONFIG/, 'disabled activation job must not materialize Drive OAuth secret');
assert.match(workflow, /SENSITIVE_BACKUP_SECRET_MATERIALIZED=0/, 'disabled disposition must explicitly prove sensitive backup secrets were not materialized');
assert.match(workflow, /DANJION_PRODUCTION_DB_URL/, 'must reuse canonical production DB secret name');
assert.match(workflow, /DANJION_BACKUP_ENCRYPTION_PASSPHRASE/, 'encryption secret binding is required');
assert.match(workflow, /DANJION_DRIVE_RCLONE_CONFIG/, 'owner OAuth rclone config secret binding is required');
assert.match(workflow, /DANJION_DRIVE_FOLDER_ID/, 'dedicated Drive folder binding is required');
assert.doesNotMatch(workflow, /actions\/upload-artifact/i, 'database backup must never become a GitHub artifact');

/* ---- restore drill must stay untouched by this fix ---- */
const restoreWorkflow = readFileSync(join(repoRoot, '.github', 'workflows', 'verify-neon-backup-restore.yml'), 'utf8');
assert.match(restoreWorkflow, /DANJION_RESTORE_SOURCE_ARMED:\s*'false'/, 'RESTORE_ARM_UNCHANGED=PASS');

assert.match(script, /RETENTION_GENERATIONS=30/, 'retention must remain bounded to 30 generations');
assert.match(script, /POSTGRES_IMAGE="postgres:18"/, 'pg_dump client must be pinned to a non-older major');
assert.match(script, /default_transaction_read_only=on/, 'Production dump session must be read-only');
assert.match(script, /pg_dump[\s\S]*--format=custom/, 'custom-format pg_dump is required');
assert.match(script, /--no-owner/, 'dump must not preserve owner coupling');
assert.match(script, /--no-acl/, 'dump must not preserve ACL coupling');
assert.match(script, /gpg[\s\S]*--passphrase-fd 0[\s\S]*--symmetric[\s\S]*AES256/, 'dump must be encrypted from stdin-provided passphrase');
assert.doesNotMatch(script, /--passphrase\s+["']?\$\{?DANJION_BACKUP_ENCRYPTION_PASSPHRASE/i, 'passphrase must never be a process argument');

const plaintextBoundary = script.indexOf('Plaintext must be destroyed');
const shredPos = script.indexOf('shred -u "${plain_dump}"', plaintextBoundary);
const driveCredentialPos = script.indexOf('printf \'%s\' "${DANJION_DRIVE_RCLONE_CONFIG}" > "${rclone_config}"');
const uploadPos = script.indexOf('rclone --config "${rclone_config}" copyto');
assert.ok(shredPos >= 0 && driveCredentialPos >= 0 && uploadPos >= 0, 'plaintext cleanup, Drive credential materialization, and upload markers must exist');
assert.ok(shredPos < driveCredentialPos, 'plaintext dump must be destroyed before Drive OAuth config is materialized');
assert.ok(driveCredentialPos < uploadPos, 'Drive OAuth config must be materialized only after plaintext destruction and before upload');
assert.match(script, /if \[ -e "\$\{plain_dump\}" \]/, 'plaintext absence must be asserted before upload');

assert.match(script, /DANJION_DRIVE_RCLONE_CONFIG/, 'Drive auth must use owner OAuth rclone config');
assert.doesNotMatch(script, /service_account_file/, 'ordinary My Drive path must not depend on service-account ownership');
assert.match(script, /--drive-root-folder-id/, 'Drive access must be rooted to the dedicated folder');
assert.match(script, /copyto[\s\S]*"\$\{encrypted_dump\}"/, 'only encrypted dump variable may be uploaded');
assert.doesNotMatch(script, /copyto[\s\S]{0,180}plain_dump/, 'plaintext dump must never be an upload source');
assert.match(script, /\^danjion-prod-\[0-9\]\{8\}T\[0-9\]\{6\}Z-/, 'retention deletion must be strict-prefix bounded');
assert.match(script, /retention_listing="\$\{tmpdir\}\/retention-listing\.txt"/, 'retention listing must be captured to a file');
assert.match(
  script,
  /if ! rclone[\s\S]*?lsf "danjion_backup:"[\s\S]*?> "\$\{retention_listing\}"/,
  'retention listing failure must be checked before filtering or deletion',
);
assert.doesNotMatch(script, /mapfile -t backups < <\(\s*rclone[\s\S]*?lsf/, 'rclone listing must not be hidden inside process substitution');
assert.match(script, /grep_status=0[\s\S]*?grep_status=\$\?[\s\S]*?\[ "\$\{grep_status\}" -gt 1 \][\s\S]*?BACKUP_RESULT=FAIL/, 'retention filter errors must fail closed');
assert.match(script, /deletefile "danjion_backup:\$\{backups\[\$i\]\}"/, 'retention may delete only filtered backup names');

for (const forbidden of [
  'DANJION_PRODUCTION_DB_URL}"',
  'DANJION_BACKUP_ENCRYPTION_PASSPHRASE}"',
  'DANJION_DRIVE_RCLONE_CONFIG}"',
]) {
  assert.ok(!script.includes(`echo "${forbidden}`), 'secret values must never be echoed');
}

assert.match(script, /--env DATABASE_URL/, 'DB URL must be inherited into Docker through environment, not embedded in argv');
assert.doesNotMatch(script, /(?:-e|--env)\s+DATABASE_URL=/, 'DB URL value must never appear in docker command arguments');
assert.match(script, /--drive-use-trash=false/, 'retention must permanently remove generations beyond the bounded 30-file policy');
assert.doesNotMatch(script, /\bpsql\b[\s\S]*(insert|update|delete|alter|drop|create)\b/i, 'backup script must not contain Production SQL writes');

process.stdout.write('ENABLE_SWITCH_USES_VARS_CONTEXT=PASS\n');
process.stdout.write('ENABLE_SWITCH_DOES_NOT_USE_SECRETS_CONTEXT=PASS\n');
process.stdout.write('JOB_OUTPUT_TRUE_FALSE_ABSENT=PASS\n');
process.stdout.write('JOB_OUTPUT_ACTIVE_DISABLED_PRESENT=PASS\n');
process.stdout.write('BACKUP_JOB_IF_ACTIVE=PASS\n');
process.stdout.write('DISABLED_JOB_IF_NOT_ACTIVE=PASS\n');
process.stdout.write('SOURCE_ARM_REQUIRED=PASS\n');
process.stdout.write('ENABLE_VARIABLE_REQUIRED=PASS\n');
process.stdout.write('EXACT_MAIN_GUARD_PRESERVED=PASS\n');
process.stdout.write('SCHEDULE_EXPECTED_MAIN_FROM_GITHUB_SHA=PASS\n');
process.stdout.write('SCHEDULE_EMPTY_DISPATCH_INPUT_DOES_NOT_FAIL_PREMATURELY=PASS\n');
process.stdout.write('PRODUCTION_ENVIRONMENT_PRESERVED=PASS\n');
process.stdout.write('RESTORE_ARM_UNCHANGED=PASS\n');
process.stdout.write('ACTIVATION_OUTPUT_TOKEN_NOT_BOOLEAN=PASS\n');
process.stdout.write('ACTIVATION_OUTPUT_TOKEN_NOT_ENABLE_SWITCH_VALUE=PASS\n');
process.stdout.write('RETENTION_LISTING_FAIL_CLOSED=PASS\n');
process.stdout.write('backup-neon-to-drive-contract: PASS\n');
