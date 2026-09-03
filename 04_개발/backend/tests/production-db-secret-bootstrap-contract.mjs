import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const script = await readFile(new URL('scripts/bootstrap-production-db-secret.ps1', root), 'utf8');

assert.match(script, /\$Repo\s*=\s*'skerishKang\/02-danji-on'/, 'repository target must be explicit');
assert.match(script, /\$Environment\s*=\s*'production'/, 'GitHub environment must be production');
assert.match(script, /\$SecretName\s*=\s*'DANJION_PRODUCTION_DB_URL'/, 'production DB secret name must be explicit');
assert.match(script, /\$NeonProjectId\s*=\s*'old-shape-61609481'/, 'canonical DanjiOn Neon project must be explicit');
assert.match(script, /\$NeonBranchId\s*=\s*'br-bold-sun-azurylwi'/, 'canonical DanjiOn production Neon branch must be explicit');
assert.match(script, /\$Workflow\s*=\s*'production-worker-bootstrap\.yml'/, 'only the guarded production Worker bootstrap may be dispatched');

assert.match(
  script,
  /Write-Output \$dbUrl \| gh secret set \$SecretName --repo \$Repo --env \$Environment/,
  'secret value must reach GitHub only through stdin'
);
assert.doesNotMatch(script, /gh secret set[^\r\n]*--body/i, 'secret must never be passed as a command-line body argument');
assert.doesNotMatch(script, /(?:Out-File|Set-Content|Add-Content|Export-Clixml)[^\r\n]*\$dbUrl/i, 'secret must never be written to a plaintext file');
assert.doesNotMatch(script, /Write-(?:Host|Output|Verbose|Debug|Information)[^\r\n]*\$dbUrl(?!\s*\|\s*gh secret set)/i, 'secret must never be printed');

assert.match(script, /\[\?&\]sslmode=require\(\?:&\|\$\)/, 'TLS sslmode=require must be validated before storage');
assert.match(script, /\[\?&\]channel_binding=require\(\?:&\|\$\)/, 'channel_binding=require must be validated before storage');
assert.match(script, /Remove-Variable dbUrl -Force/, 'in-memory secret variable must be cleared');
assert.match(script, /gh secret list --repo \$Repo --env \$Environment --json name/, 'readback must inspect secret names only');

const triggerGuard = script.indexOf('if ($TriggerWorkerBootstrap)');
const workflowRun = script.indexOf('gh workflow run $Workflow');
assert.ok(triggerGuard >= 0 && workflowRun > triggerGuard, 'production workflow dispatch must be behind an explicit switch');
assert.doesNotMatch(script.slice(0, triggerGuard), /gh workflow run/, 'no production workflow may run before the explicit trigger guard');

console.log('Production DB secret bootstrap contract: PASS');
