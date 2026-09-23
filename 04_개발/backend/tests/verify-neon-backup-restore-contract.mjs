import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fingerprintTarget } from '../scripts/verify-restore-target-identity.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const workflow = readFileSync(join(repoRoot, '.github', 'workflows', 'verify-neon-backup-restore.yml'), 'utf8');
const scriptPath = join(here, '..', 'scripts', 'verify-neon-backup-restore.sh');
const identityHelperPath = join(here, '..', 'scripts', 'verify-restore-target-identity.mjs');
const script = readFileSync(scriptPath, 'utf8');
const identityHelper = readFileSync(identityHelperPath, 'utf8');

if (process.platform !== 'win32') {
  const syntax = spawnSync('bash', ['-n', scriptPath], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, `restore drill shell syntax invalid: ${syntax.stderr || syntax.stdout}`);
}

assert.match(workflow, /workflow_dispatch:/, 'restore drill must be manual dispatch only');
assert.doesNotMatch(workflow, /^\s*schedule:/m, 'restore drill must never be scheduled');
assert.match(workflow, /DANJION_RESTORE_SOURCE_ARMED:\s*'false'/, 'restore drill must stay hard-disabled until a later owner-authorized arm change');
assert.match(workflow, /DANJION_BACKUP_RESTORE_DRILL_ENABLED:\s*\$\{\{\s*vars\.DANJION_BACKUP_RESTORE_DRILL_ENABLED\s*\}\}/, 'non-sensitive drill enable switch must use the Production environment vars context');
assert.doesNotMatch(workflow, /DANJION_BACKUP_RESTORE_DRILL_ENABLED:\s*\$\{\{\s*secrets\.DANJION_BACKUP_RESTORE_DRILL_ENABLED\s*\}\}/, 'drill enable switch must not use secrets context because runner masking can suppress job outputs');
assert.match(workflow, /DANJION_BACKUP_RESTORE_DRILL_ENABLED:-\}" != "enabled"/, 'drill enable variable must require the explicit enabled token');
assert.match(workflow, /state:\s*\$\{\{\s*steps\.activation\.outputs\.state\s*\}\}/, 'restore activation output must use state plumbing');
assert.match(workflow, /state=active/, 'restore activation output must use active token');
assert.match(workflow, /state=disabled/, 'restore activation output must use disabled token');
assert.doesNotMatch(workflow, /echo\s+"enabled=(?:true|false)"/, 'restore job outputs must not reuse boolean tokens');
assert.match(workflow, /needs\.drill-gate\.outputs\.state == 'active'/, 'drill job must depend on active state');
assert.match(workflow, /needs\.drill-gate\.outputs\.state != 'active'/, 'disabled drill job must handle every non-active state');
assert.match(workflow, /Exact main authority guard/, 'exact-main guard is required');
assert.match(workflow, /Reconfirm exact main immediately before drill/, 'exact-main must be rechecked immediately before the drill');
assert.match(workflow, /verify-neon-backup-restore-contract\.mjs/, 'the source safety contract must run inside the gate job');
assert.match(workflow, /backup_filename/, 'the drill must bind an exact Drive object name input');
assert.match(workflow, /DANJION_RESTORE_DRILL_DB_URL/, 'isolated drill target URL binding is required');
assert.match(
  workflow,
  /DANJION_RESTORE_APPROVED_TARGET_SHA256:\s*\$\{\{\s*secrets\.DANJION_RESTORE_APPROVED_TARGET_SHA256\s*\}\}/,
  'approved target identity fingerprint binding is required',
);
assert.match(workflow, /DANJION_RESTORE_APPROVED_TARGET_SHA256/, 'approved target identity must be checked by the active drill binding gate');
assert.match(workflow, /DANJION_BACKUP_ENCRYPTION_PASSPHRASE/, 'decryption secret binding is required');
assert.match(workflow, /DANJION_DRIVE_RCLONE_CONFIG/, 'owner OAuth rclone config binding is required');
assert.match(workflow, /DANJION_DRIVE_FOLDER_ID/, 'dedicated Drive folder binding is required');
assert.doesNotMatch(workflow, /actions\/upload-artifact/i, 'restore drill material must never become a GitHub artifact');

const gateBlock = workflow.split(/\n  isolated-restore-verification:/)[0];
assert.match(gateBlock, /vars\.DANJION_BACKUP_RESTORE_DRILL_ENABLED/, 'activation job must receive only the non-sensitive drill enable variable');
assert.doesNotMatch(gateBlock, /\$\{\{\s*secrets\./, 'restore activation job must bind zero Production secrets');
assert.doesNotMatch(gateBlock, /DANJION_RESTORE_DRILL_DB_URL/, 'disabled gate job must not materialize the drill target URL');
assert.doesNotMatch(gateBlock, /DANJION_RESTORE_APPROVED_TARGET_SHA256/, 'disabled gate job must not materialize the approved target fingerprint');
assert.doesNotMatch(gateBlock, /DANJION_DRIVE_RCLONE_CONFIG/, 'disabled gate job must not materialize Drive OAuth secret');
assert.doesNotMatch(gateBlock, /DANJION_BACKUP_ENCRYPTION_PASSPHRASE/, 'disabled gate job must not materialize the decryption passphrase');

assert.match(workflow, /DRIVE_DELETE=0/, 'disabled disposition must prove no Drive delete path ran');
assert.match(workflow, /RESTORE_EXECUTION=0/, 'disabled disposition must prove no restore executed');
assert.match(workflow, /SENSITIVE_RESTORE_SECRET_MATERIALIZED=0/, 'disabled disposition must prove sensitive drill secrets were not materialized');

assert.match(script, /danjion-prod-\[0-9\]\{8\}T\[0-9\]\{6\}Z-/, 'requested object must match the strict backup filename pattern');
assert.match(script, /old-shape-61609481/, 'the drill must reject the pinned Production Neon project id');
assert.match(script, /wispy-rain-16787448/, 'the drill must reject the shared-QA project id');
assert.match(script, /forbidden Production or shared-QA project/, 'target rejection must be fail-closed');
assert.match(script, /DANJION_RESTORE_APPROVED_TARGET_SHA256/, 'approved target fingerprint must be required by the restore script');
const identityCheckPos = script.indexOf('verify-restore-target-identity.mjs');
const tempDirPos = script.indexOf('tmpdir="$(mktemp -d)"');
const driveFetchPos = script.indexOf('rclone --config "${rclone_config}" copy');
assert.ok(identityCheckPos >= 0 && tempDirPos > identityCheckPos, 'target identity must be checked before temporary material is created');
assert.ok(identityCheckPos >= 0 && driveFetchPos > identityCheckPos, 'target identity must be checked before Drive fetch or restore');
assert.match(identityHelper, /createHash\('sha256'\)/, 'target identity must use SHA-256');
assert.match(identityHelper, /RESTORE_TARGET_IDENTITY=PASS/, 'target identity helper must expose only a sanitized pass marker');
assert.match(identityHelper, /MALFORMED_TARGET_URL/, 'malformed target URLs must fail closed');
assert.match(identityHelper, /NON_NEON_TARGET/, 'non-Neon target URLs must fail closed');
assert.match(identityHelper, /FORBIDDEN_TARGET_PROJECT/, 'known Production/shared-QA project markers must fail closed');
assert.match(identityHelper, /IDENTITY_MISMATCH/, 'unapproved target identities must fail closed');
assert.doesNotMatch(identityHelper, /process\.(?:stdout|stderr)\.write\([^)]*DANJION_RESTORE_DRILL_DB_URL/, 'target URL must never be printed');
assert.doesNotMatch(identityHelper, /process\.(?:stdout|stderr)\.write\([^)]*APPROVED_TARGET_SHA256[^)]*[^=]/, 'approved identity material must never be printed');

assert.match(script, /rclone[^\n]*copy "danjion_backup:"/, 'Drive access must be a scoped folder-rooted copy');
assert.match(script, /--drive-root-folder-id/, 'Drive access must be rooted to the dedicated folder');
assert.match(script, /--include "\$\{DANJION_RESTORE_BACKUP_FILENAME\}"/, 'download must be bounded to the exact requested object');
assert.doesNotMatch(script, /copyto/, 'the drill must never push files to Drive');
assert.doesNotMatch(script, /deletefile|purge|delete /, 'the drill must never delete remote backup generations');
assert.doesNotMatch(script, /service_account_file/, 'ordinary My Drive access must use the owner OAuth rclone config');

assert.match(script, /gpg[\s\S]*--passphrase-fd 0[\s\S]*--decrypt/, 'decryption must use a stdin-provided passphrase');
assert.doesNotMatch(script, /--passphrase\s+["']?\$\{?DANJION_BACKUP_ENCRYPTION_PASSPHRASE/, 'passphrase must never be a process argument');
assert.match(script, /POSTGRES_IMAGE="postgres:18"/, 'pg_restore client must be pinned to the backup client major');
assert.match(script, /pg_restore[\s\S]*--no-owner[\s\S]*--no-acl[\s\S]*--exit-on-error/, 'restore must be ownership-independent and fail-closed');
assert.match(script, /--env DATABASE_URL/, 'drill URL must reach the container through an inherited environment name only');
assert.doesNotMatch(script, /(?:-e|--env)\s+DATABASE_URL=/, 'drill URL value must never appear in docker command arguments');

const shredPos = script.indexOf('The plaintext is destroyed before any verification output');
const verifyPos = script.indexOf('verify.sql');
assert.ok(shredPos >= 0 && verifyPos > shredPos, 'plaintext must be destroyed before any verification output is produced');
assert.match(script, /if \[ -e "\$\{plain_dump\}" \]/, 'plaintext absence must be asserted before verification');

assert.match(script, /information_schema\.tables/, 'verification must be schema metadata based');
assert.doesNotMatch(script, /select \*/i, 'verification must never select row content');
assert.match(script, /DRILL_TABLE_ROWS/, 'verification output must be aggregate row counts only');

for (const secret of [
  'DANJION_BACKUP_ENCRYPTION_PASSPHRASE',
  'DANJION_DRIVE_RCLONE_CONFIG',
  'DANJION_DRIVE_FOLDER_ID',
  'DANJION_RESTORE_DRILL_DB_URL',
  'DANJION_RESTORE_APPROVED_TARGET_SHA256',
]) {
  assert.ok(!new RegExp(`echo [^\\n]*\\$\\{${secret}`).test(script), `${secret} value must never be echoed`);
}

/* ---- executable approved-target identity matrix (synthetic fixtures only) ---- */
const syntheticApprovedUrl =
  'postgresql://sentinel_user:sentinel_password@ep-sentinel-isolated-123456.us-east-2.aws.neon.tech/sentinel_db?sslmode=require';
const syntheticCanonicalUrl =
  'postgresql://ep-sentinel-isolated-123456.us-east-2.aws.neon.tech/sentinel_db?sslmode=require';
const syntheticApprovedFingerprint = createHash('sha256').update(syntheticCanonicalUrl, 'utf8').digest('hex');
assert.equal(
  fingerprintTarget(syntheticApprovedUrl),
  syntheticApprovedFingerprint,
  'approved target fingerprint must ignore credentials and use the canonical endpoint identity',
);
assert.equal(
  fingerprintTarget(syntheticApprovedUrl.replace('sentinel_password', 'rotated_sentinel_password')),
  syntheticApprovedFingerprint,
  'target fingerprint must remain stable across credential rotation',
);

const identityBaseEnv = { ...process.env };
delete identityBaseEnv.DANJION_RESTORE_DRILL_DB_URL;
delete identityBaseEnv.DANJION_RESTORE_APPROVED_TARGET_SHA256;

function runIdentityCase(url, approvedIdentity, helper = identityHelperPath) {
  const result = spawnSync(process.execPath, [helper], {
    encoding: 'utf8',
    env: {
      ...identityBaseEnv,
      DANJION_RESTORE_DRILL_DB_URL: url,
      DANJION_RESTORE_APPROVED_TARGET_SHA256: approvedIdentity,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    combined: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

const approvedIdentityRun = runIdentityCase(syntheticApprovedUrl, syntheticApprovedFingerprint);
const productionMarkerRun = runIdentityCase(
  'postgresql://sentinel_user:sentinel_password@ep-sentinel-production.aws.neon.tech/sentinel_db?project=old-shape-61609481',
  syntheticApprovedFingerprint,
);
const sharedQaMarkerRun = runIdentityCase(
  'postgresql://sentinel_user:sentinel_password@ep-sentinel-qa.aws.neon.tech/sentinel_db?project=wispy-rain-16787448',
  syntheticApprovedFingerprint,
);
const productionLikeRun = runIdentityCase(
  'postgresql://sentinel_user:sentinel_password@ep-sentinel-production-123456.us-east-2.aws.neon.tech/sentinel_db?sslmode=require',
  syntheticApprovedFingerprint,
);
const sharedQaLikeRun = runIdentityCase(
  'postgresql://sentinel_user:sentinel_password@ep-sentinel-qa-654321.us-east-2.aws.neon.tech/sentinel_db?sslmode=require',
  syntheticApprovedFingerprint,
);
const unknownTargetRun = runIdentityCase(
  'postgresql://sentinel_user:sentinel_password@ep-sentinel-unknown-654321.us-east-2.aws.neon.tech/other_db?sslmode=require',
  syntheticApprovedFingerprint,
);
const nonNeonTargetRun = runIdentityCase(
  'postgresql://sentinel_user:sentinel_password@db.example.invalid/other_db?sslmode=require',
  syntheticApprovedFingerprint,
);
const missingIdentityRun = runIdentityCase(syntheticApprovedUrl, '');
const malformedIdentityRun = runIdentityCase(syntheticApprovedUrl, 'not-a-sha256');
const malformedTargetRun = runIdentityCase('not-a-postgres-url', syntheticApprovedFingerprint);

assert.equal(approvedIdentityRun.status, 0, 'approved isolated target fixture must pass');
assert.equal(productionMarkerRun.status !== 0, true, 'production project marker target must fail');
assert.equal(sharedQaMarkerRun.status !== 0, true, 'shared-QA project marker target must fail');
assert.equal(productionLikeRun.status !== 0, true, 'production-like target without a project marker must fail');
assert.equal(sharedQaLikeRun.status !== 0, true, 'shared-QA-like target without a project marker must fail');
assert.equal(unknownTargetRun.status !== 0, true, 'unknown/unapproved target must fail');
assert.equal(nonNeonTargetRun.status !== 0, true, 'non-Neon target must fail');
assert.equal(missingIdentityRun.status !== 0, true, 'missing approved identity binding must fail');
assert.equal(malformedIdentityRun.status !== 0, true, 'malformed approved identity must fail');
assert.equal(malformedTargetRun.status !== 0, true, 'malformed target URL must fail');
for (const run of [
  approvedIdentityRun,
  productionMarkerRun,
  sharedQaMarkerRun,
  productionLikeRun,
  sharedQaLikeRun,
  unknownTargetRun,
  nonNeonTargetRun,
  missingIdentityRun,
  malformedIdentityRun,
  malformedTargetRun,
]) {
  assert.equal(run.combined.includes('sentinel_password'), false, 'target fixture password must never be printed');
  assert.equal(run.combined.includes(syntheticApprovedFingerprint), false, 'approved fingerprint must never be printed');
}

const mutationDir = mkdtempSync(join(tmpdir(), 'danjion-restore-identity-mutation-'));
try {
  const mutatedHelperPath = join(mutationDir, 'verify-restore-target-identity.mjs');
  const mutationNeedle = 'if (actualIdentity !== approvedIdentity) {';
  const mutatedSource = identityHelper.replace(
    mutationNeedle,
    'if (false && actualIdentity !== approvedIdentity) {',
  );
  assert.notEqual(mutatedSource, identityHelper, 'identity mismatch mutation must change the helper');
  writeFileSync(mutatedHelperPath, mutatedSource);
  const mutatedUnknownRun = runIdentityCase(
    'postgresql://sentinel_user:sentinel_password@ep-sentinel-unknown-654321.us-east-2.aws.neon.tech/other_db?sslmode=require',
    syntheticApprovedFingerprint,
    mutatedHelperPath,
  );
  assert.equal(mutatedUnknownRun.status, 0, 'mutation proof must demonstrate the removed mismatch guard weakens rejection');
} finally {
  rmSync(mutationDir, { recursive: true, force: true });
}

process.stdout.write('RESTORE_TARGET_IDENTITY_APPROVED_FIXTURE=PASS\n');
process.stdout.write('RESTORE_TARGET_IDENTITY_PRODUCTION_MARKER=FAIL\n');
process.stdout.write('RESTORE_TARGET_IDENTITY_SHARED_QA_MARKER=FAIL\n');
process.stdout.write('RESTORE_TARGET_IDENTITY_PRODUCTION_LIKE=FAIL\n');
process.stdout.write('RESTORE_TARGET_IDENTITY_SHARED_QA_LIKE=FAIL\n');
process.stdout.write('RESTORE_TARGET_IDENTITY_UNKNOWN=FAIL\n');
process.stdout.write('RESTORE_TARGET_IDENTITY_NON_NEON=FAIL\n');
process.stdout.write('RESTORE_TARGET_IDENTITY_MISSING_BINDING=FAIL\n');
process.stdout.write('RESTORE_TARGET_IDENTITY_MALFORMED_IDENTITY=FAIL\n');
process.stdout.write('RESTORE_TARGET_IDENTITY_MALFORMED=FAIL\n');
process.stdout.write('RESTORE_TARGET_IDENTITY_MUTATION_PROOF=PASS\n');
process.stdout.write('RESTORE_ENABLE_SWITCH_USES_VARS_CONTEXT=PASS\n');
process.stdout.write('RESTORE_ENABLE_SWITCH_DOES_NOT_USE_SECRETS_CONTEXT=PASS\n');
process.stdout.write('RESTORE_JOB_OUTPUT_TRUE_FALSE_ABSENT=PASS\n');
process.stdout.write('RESTORE_JOB_OUTPUT_ACTIVE_DISABLED_PRESENT=PASS\n');
process.stdout.write('RESTORE_ACTIVATION_JOB_SECRET_BINDINGS=0\n');
process.stdout.write('verify-neon-backup-restore-contract: PASS\n');
