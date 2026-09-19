import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const workflow = readFileSync(join(repoRoot, '.github', 'workflows', 'backup-neon-to-drive.yml'), 'utf8');
const script = readFileSync(join(here, '..', 'scripts', 'backup-neon-to-drive.sh'), 'utf8');

assert.match(workflow, /cron:\s*'17 18 \* \* \*'/, 'daily candidate schedule must remain 24h');
assert.match(workflow, /environment:\s*production/, 'backup must use the production environment boundary');
assert.match(workflow, /DANJION_BACKUP_ENABLED/, 'explicit activation secret gate is required');
assert.match(workflow, /steps\.activation\.outputs\.enabled == 'true'/, 'active steps must depend on enable gate');
assert.match(workflow, /Exact main authority guard/, 'exact-main guard is required');
assert.match(workflow, /DANJION_PRODUCTION_DB_URL/, 'must reuse canonical production DB secret name');
assert.match(workflow, /DANJION_BACKUP_ENCRYPTION_PASSPHRASE/, 'encryption secret binding is required');
assert.match(workflow, /DANJION_DRIVE_SERVICE_ACCOUNT_JSON/, 'Drive service-account secret binding is required');
assert.match(workflow, /DANJION_DRIVE_FOLDER_ID/, 'dedicated Drive folder binding is required');
assert.doesNotMatch(workflow, /actions\/upload-artifact/i, 'database backup must never become a GitHub artifact');

assert.match(script, /RETENTION_GENERATIONS=30/, 'retention must remain bounded to 30 generations');
assert.match(script, /POSTGRES_IMAGE="postgres:18"/, 'pg_dump client must be pinned to a non-older major');
assert.match(script, /default_transaction_read_only=on/, 'Production dump session must be read-only');
assert.match(script, /pg_dump[\s\S]*--format=custom/, 'custom-format pg_dump is required');
assert.match(script, /--no-owner/, 'dump must not preserve owner coupling');
assert.match(script, /--no-acl/, 'dump must not preserve ACL coupling');
assert.match(script, /gpg[\s\S]*--passphrase-fd 0[\s\S]*--symmetric[\s\S]*AES256/, 'dump must be encrypted from stdin-provided passphrase');
assert.doesNotMatch(script, /--passphrase\s+["']?\$\{?DANJION_BACKUP_ENCRYPTION_PASSPHRASE/i, 'passphrase must never be a process argument');

const shredPos = script.indexOf('shred -u "${plain_dump}"');
const driveCredentialPos = script.indexOf('DANJION_DRIVE_SERVICE_ACCOUNT_JSON');
const uploadPos = script.indexOf('rclone --config "${rclone_config}" copyto');
assert.ok(shredPos >= 0 && driveCredentialPos >= 0 && uploadPos >= 0, 'plaintext cleanup, Drive credential, and upload markers must exist');
assert.ok(shredPos < uploadPos, 'plaintext dump must be destroyed before upload');
assert.match(script, /if \[ -e "\$\{plain_dump\}" \]/, 'plaintext absence must be asserted before upload');

assert.match(script, /service_account_file/, 'Drive auth must use service account file');
assert.match(script, /root_folder_id/, 'Drive access must be rooted to the dedicated folder');
assert.match(script, /copyto[\s\S]*"\$\{encrypted_dump\}"/, 'only encrypted dump variable may be uploaded');
assert.doesNotMatch(script, /copyto[\s\S]{0,180}plain_dump/, 'plaintext dump must never be an upload source');
assert.match(script, /\^danjion-prod-\[0-9\]\{8\}T\[0-9\]\{6\}Z-/, 'retention deletion must be strict-prefix bounded');
assert.match(script, /deletefile "danjion_backup:\$\{backups\[\$i\]\}"/, 'retention may delete only filtered backup names');

for (const forbidden of [
  'DANJION_PRODUCTION_DB_URL}"',
  'DANJION_BACKUP_ENCRYPTION_PASSPHRASE}"',
  'DANJION_DRIVE_SERVICE_ACCOUNT_JSON}"',
]) {
  assert.ok(!script.includes(`echo "${forbidden}`), 'secret values must never be echoed');
}

assert.doesNotMatch(script, /\bpsql\b[\s\S]*(insert|update|delete|alter|drop|create)\b/i, 'backup script must not contain Production SQL writes');

process.stdout.write('backup-neon-to-drive-contract: PASS\n');
