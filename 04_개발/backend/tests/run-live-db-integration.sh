#!/usr/bin/env bash
set -euo pipefail

if [[ "${DANJION_DB_TARGET:-}" != "child" ]]; then
  echo "BLOCKED: DANJION_DB_TARGET must be exactly 'child'. Production/default DB targets are refused." >&2
  exit 20
fi

if [[ -z "${LIVE_DATABASE_URL:-}" ]]; then
  echo "BLOCKED: LIVE_DATABASE_URL is required for the Neon child branch." >&2
  exit 21
fi

if [[ -n "${PRODUCTION_DATABASE_URL:-}" && "${LIVE_DATABASE_URL}" == "${PRODUCTION_DATABASE_URL}" ]]; then
  echo "REFUSED: LIVE_DATABASE_URL matches PRODUCTION_DATABASE_URL." >&2
  exit 22
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "BLOCKED: psql is required." >&2
  exit 23
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

echo "Track D DB target acknowledged as Neon child branch."
echo "Production seed/write is not permitted by this harness."
psql "${LIVE_DATABASE_URL}" \
  -v ON_ERROR_STOP=1 \
  -c "select current_database() as database, current_user as database_user, version() as postgres_version;" \
  -f "${SCRIPT_DIR}/live-db-integration.sql"
