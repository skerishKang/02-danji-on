#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${DANJION_BACKUP_ENCRYPTION_PASSPHRASE:?required}"
: "${DANJION_DRIVE_RCLONE_CONFIG:?required}"
: "${DANJION_DRIVE_FOLDER_ID:?required}"
: "${DANJION_RESTORE_DRILL_DB_URL:?required}"
: "${DANJION_RESTORE_BACKUP_FILENAME:?required}"

POSTGRES_IMAGE="postgres:18"
FILE_PATTERN='^danjion-prod-[0-9]{8}T[0-9]{6}Z-[0-9a-fA-F]{12}\.dump\.gpg$'
# The drill target URL is provided through the variable named here, never
# hardcoded, so this file itself must never contain an endpoint value.
DRILL_URL_ENV_NAME="DANJION_RESTORE_DRILL_DB_URL"
FORBIDDEN_TARGET_MARKERS=(
  "old-shape-61609481"
  "wispy-rain-16787448"
)

fail() {
  echo "RESTORE_DRILL_RESULT=FAIL reason=$1"
  exit 1
}

if [[ ! "${DANJION_RESTORE_BACKUP_FILENAME}" =~ ${FILE_PATTERN} ]]; then
  fail "backup filename does not match the strict danjion-prod pattern"
fi

drill_url="${!DRILL_URL_ENV_NAME:-}"
if [ -z "${drill_url}" ]; then
  fail "drill target url binding is missing"
fi

for marker in "${FORBIDDEN_TARGET_MARKERS[@]}"; do
  if [[ "${drill_url}" == *"${marker}"* ]]; then
    fail "drill target resolves to a forbidden Production or shared-QA project"
  fi
done

tmpdir="$(mktemp -d)"
rclone_config="${tmpdir}/rclone.conf"
encrypted_file="${tmpdir}/${DANJION_RESTORE_BACKUP_FILENAME}"
plain_dump="${tmpdir}/restore.dump"

cleanup() {
  if [ -f "${plain_dump}" ]; then
    shred -u "${plain_dump}" 2>/dev/null || rm -f "${plain_dump}"
  fi
  rm -rf "${tmpdir}"
}
trap cleanup EXIT INT TERM

printf '%s' "${DANJION_DRIVE_RCLONE_CONFIG}" > "${rclone_config}"

if ! grep -Eq '^\[danjion_backup\][[:space:]]*$' "${rclone_config}"; then
  fail "rclone remote section is not the bound danjion_backup remote"
fi

if ! grep -Eq '^[[:space:]]*type[[:space:]]*=[[:space:]]*drive[[:space:]]*$' "${rclone_config}"; then
  fail "rclone remote is not a Drive remote"
fi

# Download-only drill: scoped to the dedicated folder and the one exact
# filename. Nothing is uploaded and no remote object is ever deleted here.
rclone --config "${rclone_config}" copy "danjion_backup:" "${tmpdir}" \
  --drive-root-folder-id "${DANJION_DRIVE_FOLDER_ID}" \
  --include "${DANJION_RESTORE_BACKUP_FILENAME}" \
  --quiet || fail "drive fetch of the named encrypted object failed"

if [ ! -f "${encrypted_file}" ]; then
  fail "requested encrypted object was not present in the dedicated folder"
fi

if [ ! -s "${encrypted_file}" ]; then
  fail "fetched encrypted object is empty"
fi

encrypted_bytes="$(wc -c < "${encrypted_file}" | tr -d ' ')"

# Decryption stays on the ephemeral runner only. The passphrase is supplied via
# stdin; it never appears in argv, filenames, configuration, or logs.
printf '%s' "${DANJION_BACKUP_ENCRYPTION_PASSPHRASE}" | \
  gpg --batch --yes --pinentry-mode loopback \
    --passphrase-fd 0 \
    --decrypt --output "${plain_dump}" "${encrypted_file}" \
    >/dev/null 2>&1

if [ ! -s "${plain_dump}" ]; then
  fail "decryption produced no plaintext dump"
fi

plain_bytes="$(wc -c < "${plain_dump}" | tr -d ' ')"

# Restore into the isolated drill target. The URL travels by inherited
# environment name into the container; its value is never embedded in argv.
export DATABASE_URL="${drill_url}"
docker run --rm \
  --env DATABASE_URL \
  -v "${tmpdir}:/restore:ro" \
  "${POSTGRES_IMAGE}" \
  sh -ceu 'pg_restore --no-owner --no-acl --exit-on-error --dbname="$DATABASE_URL" "/restore/restore.dump"' \
  >/dev/null

# The plaintext is destroyed before any verification output is produced.
shred -u "${plain_dump}" 2>/dev/null || rm -f "${plain_dump}"
if [ -e "${plain_dump}" ]; then
  fail "plaintext dump survived cleanup"
fi

# Integrity verification: schema metadata and per-table aggregate row counts
# only. No row content is selected, printed, or shipped anywhere.
verify_sql="${tmpdir}/verify.sql"
cat > "${verify_sql}" <<'SQL'
do $$
declare
  t record;
  n bigint;
begin
  if to_regclass('public.app_users') is null then
    raise exception 'identity marker table app_users missing after restore';
  end if;
  if to_regclass('public.households') is null then
    raise exception 'household marker table households missing after restore';
  end if;
  raise notice 'DRILL_TABLE_COUNT=%', (
    select count(*) from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  );
  for t in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name asc
  loop
    execute format('select count(*) from %I', t.table_name) into n;
    raise notice 'DRILL_TABLE_ROWS=%=%', t.table_name, n;
  end loop;
  raise notice 'DRILL_INTEGRITY=PASS';
end
$$;
SQL

drill_report="$(docker run --rm \
  --env DATABASE_URL \
  -v "${tmpdir}:/restore:ro" \
  "${POSTGRES_IMAGE}" \
  sh -ceu 'psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -tA -f /restore/verify.sql' 2>&1)" || true
unset DATABASE_URL drill_url

if ! grep -q 'DRILL_INTEGRITY=PASS' <<<"${drill_report}"; then
  fail "restore integrity verification did not pass"
fi

grep -E '^DRILL_TABLE_COUNT=' <<<"${drill_report}"
echo "RESTORE_DRILL_RESULT=PASS"
echo "DUMP_BYTES=${plain_bytes}"
echo "ENCRYPTED_BYTES=${encrypted_bytes}"
echo "PRODUCTION_DB_WRITE=0"
echo "SHARED_QA_WRITE=0"
echo "DRIVE_WRITE=0"
echo "DRIVE_DELETE=0"
