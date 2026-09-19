#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${DANJION_PRODUCTION_DB_URL:?required}"
: "${DANJION_BACKUP_ENCRYPTION_PASSPHRASE:?required}"
: "${DANJION_DRIVE_RCLONE_CONFIG:?required}"
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
# attempts to write. Pass DATABASE_URL by inherited environment name only so
# the secret value is not embedded in docker CLI arguments.
export DATABASE_URL="${DANJION_PRODUCTION_DB_URL}"
export PGOPTIONS="-c default_transaction_read_only=on"

docker run --rm \
  --env DATABASE_URL \
  --env PGOPTIONS \
  -v "${tmpdir}:/backup" \
  "${POSTGRES_IMAGE}" \
  sh -ceu 'pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl --file=/backup/danjion.dump' \
  >/dev/null

unset DATABASE_URL PGOPTIONS

if [ ! -s "${plain_dump}" ]; then
  echo "BACKUP_RESULT=FAIL"
  exit 1
fi

dump_bytes="$(wc -c < "${plain_dump}" | tr -d ' ')"

# The passphrase travels through stdin only; it is never placed in argv,
# filenames, the rclone config, or log output.
printf '%s' "${DANJION_BACKUP_ENCRYPTION_PASSPHRASE}" | \
  gpg --batch --yes --pinentry-mode loopback \
    --passphrase-fd 0 \
    --symmetric --cipher-algo AES256 \
    --output "${encrypted_dump}" "${plain_dump}" \
    >/dev/null 2>&1

if [ ! -s "${encrypted_dump}" ]; then
  echo "BACKUP_RESULT=FAIL"
  exit 1
fi

encrypted_bytes="$(wc -c < "${encrypted_dump}" | tr -d ' ')"

# Plaintext must be destroyed before any Drive OAuth material is written to
# disk and before any network upload begins.
shred -u "${plain_dump}" 2>/dev/null || rm -f "${plain_dump}"

if [ -e "${plain_dump}" ]; then
  echo "BACKUP_RESULT=FAIL"
  exit 1
fi

printf '%s' "${DANJION_DRIVE_RCLONE_CONFIG}" > "${rclone_config}"

if ! grep -Eq '^\[danjion_backup\][[:space:]]*$' "${rclone_config}"; then
  echo "BACKUP_RESULT=FAIL"
  exit 1
fi

if ! grep -Eq '^[[:space:]]*type[[:space:]]*=[[:space:]]*drive[[:space:]]*$' "${rclone_config}"; then
  echo "BACKUP_RESULT=FAIL"
  exit 1
fi

# Only the encrypted file is uploaded, and all operations are rooted to the
# dedicated backup folder supplied by the owner.
rclone --config "${rclone_config}" copyto \
  "${encrypted_dump}" "danjion_backup:${backup_name}" \
  --drive-root-folder-id "${DANJION_DRIVE_FOLDER_ID}" \
  --immutable --quiet

# Retention is filename-bounded. Never delete unrelated Drive files.
mapfile -t backups < <(
  rclone --config "${rclone_config}" lsf "danjion_backup:" \
    --drive-root-folder-id "${DANJION_DRIVE_FOLDER_ID}" \
    --files-only --format p --quiet |
    grep -E '^danjion-prod-[0-9]{8}T[0-9]{6}Z-[0-9a-fA-F]{12}\.dump\.gpg$' |
    LC_ALL=C sort -r
)

if [ "${#backups[@]}" -gt "${RETENTION_GENERATIONS}" ]; then
  for ((i=RETENTION_GENERATIONS; i<${#backups[@]}; i++)); do
    rclone --config "${rclone_config}" deletefile "danjion_backup:${backups[$i]}" \
      --drive-root-folder-id "${DANJION_DRIVE_FOLDER_ID}" \
      --drive-use-trash=false --quiet
  done
fi

echo "BACKUP_RESULT=PASS"
echo "DUMP_BYTES=${dump_bytes}"
echo "ENCRYPTED_BYTES=${encrypted_bytes}"
