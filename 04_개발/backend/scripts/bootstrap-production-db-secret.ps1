[CmdletBinding()]
param(
  [switch]$TriggerWorkerBootstrap
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repo = 'skerishKang/02-danji-on'
$Environment = 'production'
$SecretName = 'DANJION_PRODUCTION_DB_URL'
$NeonProjectId = 'old-shape-61609481'
$NeonBranchId = 'br-bold-sun-azurylwi'
$Workflow = 'production-worker-bootstrap.yml'

function Assert-Command {
  param([Parameter(Mandatory = $true)][string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command is not available: $Name"
  }
}

Assert-Command gh
Assert-Command npx

& gh auth status --hostname github.com *> $null
if ($LASTEXITCODE -ne 0) {
  throw 'GitHub CLI is not authenticated. Run gh auth login first.'
}

Write-Host 'Resolving the DanjiOn production Neon connection string without printing it...'

$dbUrl = (& npx --yes neonctl@latest cs $NeonBranchId "--project-id=$NeonProjectId" 2>&1 |
  ForEach-Object { [string]$_ } |
  Where-Object { $_ -match '^postgres(?:ql)?://' } |
  Select-Object -Last 1)

if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($dbUrl)) {
  Remove-Variable dbUrl -Force -ErrorAction SilentlyContinue
  throw 'Neon CLI did not return a production PostgreSQL connection string. Authenticate Neon CLI and retry.'
}

$dbUrl = $dbUrl.Trim()
if ($dbUrl -notmatch '^postgresql://') {
  Remove-Variable dbUrl -Force -ErrorAction SilentlyContinue
  throw 'Unexpected Neon connection-string scheme.'
}
if ($dbUrl -notmatch '[?&]sslmode=require(?:&|$)') {
  Remove-Variable dbUrl -Force -ErrorAction SilentlyContinue
  throw 'Refusing to store a production DB URL without sslmode=require.'
}
if ($dbUrl -notmatch '[?&]channel_binding=require(?:&|$)') {
  Remove-Variable dbUrl -Force -ErrorAction SilentlyContinue
  throw 'Refusing to store a production DB URL without channel_binding=require.'
}

try {
  Write-Output $dbUrl | gh secret set $SecretName --repo $Repo --env $Environment
  if ($LASTEXITCODE -ne 0) {
    throw 'GitHub CLI failed to store the production DB secret.'
  }
}
finally {
  Remove-Variable dbUrl -Force -ErrorAction SilentlyContinue
}

$secretNames = gh secret list --repo $Repo --env $Environment --json name | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) {
  throw 'GitHub CLI could not read back production environment secret names.'
}
if (-not ($secretNames | Where-Object { $_.name -eq $SecretName })) {
  throw 'Production DB secret name was not found after write.'
}

Write-Host 'DANJION_PRODUCTION_DB_URL is present in the GitHub production environment. Secret value was not printed.'

if ($TriggerWorkerBootstrap) {
  Write-Host 'Triggering the guarded Production Worker Bootstrap workflow...'
  gh workflow run $Workflow --repo $Repo -f confirm_production=true
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to dispatch Production Worker Bootstrap.'
  }
  Write-Host 'Production Worker Bootstrap dispatch accepted. Use GitHub Actions/CENTRAL for run verification.'
}
else {
  Write-Host 'Worker bootstrap was not triggered. Re-run with -TriggerWorkerBootstrap after secret-name verification if desired.'
}
