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

assert.match(workflow, /cron:\s*'17 18 \* \* \*'/, 'daily candidate schedule must remain 24h');
assert.match(workflow, /environment:\s*production/, 'backup must use the production environment boundary');
assert.match(workflow, /DANJION_BACKUP_ENABLED/, 'explicit activation secret gate is required');
assert.match(workflow, /DANJION_BACKUP_SOURCE_ARMED:\s*'true'/, 'source arm is owner-authorized (#714); runtime activation still requires the separate DANJION_BACKUP_ENABLED secret');
assert.match(workflow, /needs\.activation-gate\.outputs\.enabled == 'true'/, 'backup job must depend on enable gate');
assert.match(workflow, /Exact main authority guard/, 'exact-main guard is required');
assert.match(workflow, /DANJION_PRODUCTION_DB_URL/, 'must reuse canonical production DB secret name');
assert.match(workflow, /DANJION_BACKUP_ENCRYPTION_PASSPHRASE/, 'encryption secret binding is required');
assert.match(workflow, /DANJION_DRIVE_RCLONE_CONFIG/, 'owner OAuth rclone config secret binding is required');
assert.match(workflow, /DANJION_DRIVE_FOLDER_ID/, 'dedicated Drive folder binding is required');
assert.doesNotMatch(workflow, /actions\/upload-artifact/i, 'database backup must never become a GitHub artifact');
const activationBlock = workflow.split(/\n  encrypted-backup:/)[0];
assert.match(activationBlock, /DANJION_BACKUP_ENABLED/, 'activation job must receive only the enable secret');
assert.doesNotMatch(activationBlock, /DANJION_PRODUCTION_DB_URL/, 'disabled activation job must not materialize DB URL');
assert.doesNotMatch(activationBlock, /DANJION_BACKUP_ENCRYPTION_PASSPHRASE/, 'disabled activation job must not materialize encryption secret');
assert.doesNotMatch(activationBlock, /DANJION_DRIVE_RCLONE_CONFIG/, 'disabled activation job must not materialize Drive OAuth secret');
assert.match(workflow, /Reconfirm exact main immediately before backup/, 'exact-main must be rechecked immediately before backup');
assert.match(workflow, /SENSITIVE_BACKUP_SECRET_MATERIALIZED=0/, 'disabled disposition must explicitly prove sensitive backup secrets were not materialized');

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

process.stdout.write('backup-neon-to-drive-contract: PASS\n');
