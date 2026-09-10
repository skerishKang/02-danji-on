#!/usr/bin/env bash
# #362 part B: owner application list carries document metadata.
# Applies 001 + 002 + 019 + 045 + 048 against a scratch database and runs the
# GET /api/v1/me/business-applications SELECT from core-v1.ts verbatim
# (only the actor uuid is interpolated) to prove:
#   A. documents[] attaches to every actor-owned application
#   B. document rows are scoped through the actor-filtered application set
#      (another applicant's document id/objectKey can never appear)
#   C. applications without documents return a truthful [] (never null)
#   D. id/objectKey/kind/sortOrder metadata semantics are exact, id is the
#      uuid the #310 owner byte route requires
#   E. existing list fields and created_at desc ordering are preserved
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
psql_cmd=(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q)

expect_scalar() {
  local label="$1"
  local expected="$2"
  local query="$3"
  local actual
  actual="$("${psql_cmd[@]}" -At -c "$query")"
  if [ "$actual" != "$expected" ]; then
    echo "FAIL ${label}: expected [$expected] got [$actual]"
    exit 1
  fi
  echo "PASS ${label}"
}

OWNER_A='22222222-2222-4222-8222-222222222222'
OWNER_B='23333333-3333-4333-8333-333333333333'
COMPLEX='11111111-1111-4111-8111-111111111111'
APP_A1='41111111-1111-4111-8111-111111111111'
APP_A2='41111111-1111-4111-8111-111111111112'
APP_B1='41111111-1111-4111-8111-111111111113'
DOC_A1='51111111-1111-4111-8111-111111111111'
DOC_A2='51111111-1111-4111-8111-111111111112'
DOC_B1='51111111-1111-4111-8111-111111111113'
KEY_A1='gdrive/private/application-document/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
KEY_A2='gdrive/private/application-document/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
KEY_B1='gdrive/private/application-document/cccccccccccccccccccccccccccccccccccccccc'

"${psql_cmd[@]}" -f migrations/001_initial_schema.sql
"${psql_cmd[@]}" -f migrations/002_admin_workflow.sql
"${psql_cmd[@]}" -f migrations/019_business_image_lifecycle_registry.sql
"${psql_cmd[@]}" -f migrations/045_application_documents.sql
"${psql_cmd[@]}" -f migrations/048_owner_application_relation_resolution.sql

"${psql_cmd[@]}" <<SQL
insert into complexes (id, slug, name) values
  ('$COMPLEX', 'gap5-list-complex', 'GAP5 List Complex');
insert into app_users (id, auth_user_id, display_name) values
  ('$OWNER_A', 'gap5-owner-a', 'GAP5 Owner A'),
  ('$OWNER_B', 'gap5-owner-b', 'GAP5 Owner B');
insert into business_applications
  (id, complex_id, applicant_user_id, relation_type, business_name, category_name, service_summary, status, created_at, updated_at)
values
  ('$APP_A1', '$COMPLEX', '$OWNER_A', 'resident', 'GAP5 Shop A1', 'food', 'summary a1', 'pending', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('$APP_A2', '$COMPLEX', '$OWNER_A', 'resident', 'GAP5 Shop A2', 'cafe', 'summary a2', 'approved', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'),
  ('$APP_B1', '$COMPLEX', '$OWNER_B', 'resident', 'GAP5 Shop B1', 'food', 'summary b1', 'pending', '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z');
insert into business_application_documents (id, application_id, object_key, document_kind, sort_order) values
  ('$DOC_A1', '$APP_A1', '$KEY_A1', 'operation_proof', 0),
  ('$DOC_A2', '$APP_A1', '$KEY_A2', 'other_evidence', 1),
  ('$DOC_B1', '$APP_B1', '$KEY_B1', 'additional_reference', 0);
SQL

# The exact SELECT from core-v1.ts, with only the actor uuid interpolated.
owner_list() {
  cat <<SQL
select a.id, c.slug as complex_slug, a.relation_type, a.relation_raw,
       a.resolved_relation_type, a.business_name,
       a.category_name, a.service_summary, a.status, a.review_note,
       a.approved_business_id, a.created_at, a.updated_at,
       coalesce((
         select json_agg(json_build_object(
           'id', d.id,
           'objectKey', d.object_key,
           'kind', d.document_kind,
           'sortOrder', d.sort_order
         ) order by d.sort_order)
         from business_application_documents d
         where d.application_id = a.id
       ), '[]'::json) as documents
from business_applications a
join complexes c on c.id = a.complex_id
where a.applicant_user_id = '$1'::uuid
order by a.created_at desc
SQL
}

LIST_A="$(owner_list "$OWNER_A")"
LIST_B="$(owner_list "$OWNER_B")"

# A. the actor sees exactly their own applications, each with documents[].
expect_scalar 'owner A list carries exactly two applications' \
  '2' \
  "select count(*) from ($LIST_A) x"

# E. created_at desc ordering preserved by the query itself.
expect_scalar 'owner A list keeps created_at desc ordering' \
  "$APP_A2" \
  "select x.id from ($LIST_A) x limit 1"

# A/C. documents[] present per application: 2 docs on APP_A1, truthful [] on APP_A2.
expect_scalar 'application with documents carries both rows' \
  '2' \
  "select json_array_length(x.documents) from ($LIST_A) x where x.id = '$APP_A1'"
expect_scalar 'application without documents returns truthful empty array' \
  '[]' \
  "select x.documents::text from ($LIST_A) x where x.id = '$APP_A2'"

# D. metadata semantics exact and ordered by sort_order; id is the uuid byte-route key.
expect_scalar 'first document exposes its opaque id' \
  "$DOC_A1" \
  "select x.documents->0->>'id' from ($LIST_A) x where x.id = '$APP_A1'"
expect_scalar 'first document exposes objectKey' \
  "$KEY_A1" \
  "select x.documents->0->>'objectKey' from ($LIST_A) x where x.id = '$APP_A1'"
expect_scalar 'documents ordered by sort_order with kind/sortOrder intact' \
  "operation_proof|other_evidence|0|1" \
  "select x.documents->0->>'kind' || '|' || x.documents->1->>'kind' || '|' ||
          x.documents->0->>'sortOrder' || '|' || x.documents->1->>'sortOrder'
   from ($LIST_A) x where x.id = '$APP_A1'"
expect_scalar 'document id parses as the uuid the owner byte route requires' \
  't' \
  "select (x.documents->0->>'id')::uuid = '$DOC_A1'::text::uuid from ($LIST_A) x where x.id = '$APP_A1'"

# B. cross-owner leakage impossible: owner A never sees owner B's document id or key.
expect_scalar 'owner A response never contains another applicant document id' \
  '0' \
  "select count(*) from ($LIST_A) x where x.documents::text like '%$DOC_B1%' or x.documents::text like '%$KEY_B1%'"
expect_scalar 'owner B sees only their own application' \
  "$APP_B1" \
  "select x.id from ($LIST_B) x limit 1"
expect_scalar 'owner B documents carry only their own row' \
  "$DOC_B1" \
  "select x.documents->0->>'id' from ($LIST_B) x where x.id = '$APP_B1'"
expect_scalar 'owner B response never contains owner A document identity' \
  '0' \
  "select count(*) from ($LIST_B) x where x.documents::text like '%$DOC_A1%' or x.documents::text like '%$KEY_A1%' or x.documents::text like '%$KEY_A2%'"

# E. existing application fields untouched.
expect_scalar 'existing list fields preserved alongside documents' \
  "GAP5 Shop A1|pending|gap5-list-complex|food|summary a1" \
  "select x.business_name || '|' || x.status || '|' || x.complex_slug || '|' || x.category_name || '|' || x.service_summary
   from ($LIST_A) x where x.id = '$APP_A1'"

echo 'PASS #362 owner application list document metadata postgres lifecycle'
