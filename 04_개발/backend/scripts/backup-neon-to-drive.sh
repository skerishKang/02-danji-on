#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${DANJION_PRODUCTION_DB_URL:?required}"
: "${DANJION_BACKUP_ENCRYPTION_PASSPHRASE:?required}"
: "${DANJION_DRIVE_SERVICE_ACCOUNT_JSON:?required}"
: "${DANJION_DRIVE_FOLDER_ID:?required}"
: "${GITHUB_SHA:?required}"

RETENTION_GENERATIONS=30
POSTGRES_IMAGE="postgres:18"

if ! [[ "${GITHUB_SHA}" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "BACKUP_RESULT=FAIL"
  exit 1
fi

tmpdir="$(mktemp -d)"
plain_dump="${tmpdir}/danjion.dump"
service_account_file="${tmpdir}/drive-service-account.json"
rclone_config="${tmpdir}/rclone.conf"

cleanup() {
  if [ -f "${plain_dump}" ]; then
    shred -u "${plain_dump}" 2>/dev/null || rm -f "${plain_dump}"
  fi
  rm -rf "${tmpdir}"
}
trap cleanup EXIT INT TERM

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
short_sha="${GITHUB_SHA:0:12}"
backup_name="danjion-prod-${timestamp}-${short_sha}.dump.gpg"
encrypted_dump="${tmpdir}/${backup_name}"

# pg_dump is read-only. PGOPTIONS makes the session fail closed if any command
# attempts to write. A PostgreSQL 18 client is used so the client is not older
# than the current supported Neon server family.
docker run --rm   -e DATABASE_URL="${DANJION_PRODUCTION_DB_URL}"   -e PGOPTIONS="-c default_transaction_read_only=on"   -v "${tmpdir}:/backup"   "${POSTGRES_IMAGE}"   sh -ceu 'pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl --file=/backup/danjion.dump'   >/dev/null

if [ ! -s "${plain_dump}" ]; then
  echo "BACKUP_RESULT=FAIL"
  exit 1
fi
dump_bytes="$(wc -c < "${plain_dump}" | tr -d ' ')"

# Passphrase is supplied only through stdin; it is never placed in a command
# argument, config file, filename, or log line.
printf '%s' "${DANJION_BACKUP_ENCRYPTION_PASSPHRASE}" |   gpg --batch --yes --pinentry-mode loopback     --passphrase-fd 0     --symmetric --cipher-algo AES256     --output "${encrypted_dump}" "${plain_dump}"     >/dev/null 2>&1

if [ ! -s "${encrypted_dump}" ]; then
  echo "BACKUP_RESULT=FAIL"
  exit 1
fi
encrypted_bytes="$(wc -c < "${encrypted_dump}" | tr -d ' ')"

# Plaintext must be gone before any Drive credential is materialized or any
# network upload command is executed.
shred -u "${plain_dump}" 2>/dev/null || rm -f "${plain_dump}"
if [ -e "${plain_dump}" ]; then
  echo "BACKUP_RESULT=FAIL"
  exit 1
fi

printf '%s' "${DANJION_DRIVE_SERVICE_ACCOUNT_JSON}" > "${service_account_file}"
python3 - "${service_account_file}" <<'PY' >/dev/null
import json, sys
with open(sys.argv[1], 'r', encoding='utf-8') as f:
    data = json.load(f)
if data.get('type') != 'service_account':
    raise SystemExit(1)
PY

cat > "${rclone_config}" <<EOF
[danjion_backup]
type = drive
scope = drive
service_account_file = ${service_account_file}
root_folder_id = ${DANJION_DRIVE_FOLDER_ID}
EOF

# Only the encrypted file is uploaded.
rclone --config "${rclone_config}" copyto   "${encrypted_dump}" "danjion_backup:${backup_name}"   --immutable --quiet

# Retention is filename-bounded. Never delete unrelated files from the shared
# folder even if they are visible to the service account.
mapfile -t backups < <(
  rclone --config "${rclone_config}" lsf "danjion_backup:" --files-only --format p --quiet |
    grep -E '^danjion-prod-[0-9]{8}T[0-9]{6}Z-[0-9a-fA-F]{12}\.dump\.gpg$' |
    LC_ALL=C sort -r
)

if [ "${#backups[@]}" -gt "${RETENTION_GENERATIONS}" ]; then
  for ((i=RETENTION_GENERATIONS; i<${#backups[@]}; i++)); do
    rclone --config "${rclone_config}" deletefile "danjion_backup:${backups[$i]}" --quiet
  done
fi

echo "BACKUP_RESULT=PASS"
echo "DUMP_BYTES=${dump_bytes}"
echo "ENCRYPTED_BYTES=${encrypted_bytes}"
