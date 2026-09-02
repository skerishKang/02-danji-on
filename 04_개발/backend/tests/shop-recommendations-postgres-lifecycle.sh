#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
psql_cmd=(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q)

expect_fail() {
  local label="$1"
  local statement="$2"
  local output
  output="$(mktemp)"
  if "${psql_cmd[@]}" -c "$statement" >"$output" 2>&1; then
    echo "FAIL ${label}: statement unexpectedly succeeded"
    cat "$output"
    rm -f "$output"
    exit 1
  fi
  rm -f "$output"
  echo "PASS ${label}"
}

"${psql_cmd[@]}" -f migrations/001_initial_schema.sql
"${psql_cmd[@]}" -f migrations/029_shop_recommendations.sql

"${psql_cmd[@]}" <<'SQL'
insert into complexes (id, slug, name, status) values
  ('10000000-0000-4000-8000-000000000001', 'complex-one', 'Complex One', 'active');

insert into app_users (id, auth_user_id, display_name) values
  ('20000000-0000-4000-8000-000000000001', 'reporter-a', 'Reporter A'),
  ('20000000-0000-4000-8000-000000000002', 'operator-b', 'Operator B');

insert into business_categories (id, slug, name, is_active) values
  ('30000000-0000-4000-8000-000000000001', 'food', 'Food', true);

insert into shop_recommendations (
  id, complex_id, reporter_user_id, relation_type, business_name,
  category_name, service_summary, service_area
) values (
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'neighbor', 'Recommended Shop', 'Food', 'Resident recommendation', 'Near complex'
);
SQL

expect_fail \
  "resident owner relation rejected in recommendation lane" \
  "insert into shop_recommendations (complex_id,reporter_user_id,relation_type,business_name,category_name,service_summary) values ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','resident','Bad','Food','Bad relation')"

"${psql_cmd[@]}" <<'SQL'
with approved as (
  update shop_recommendations r
  set status = 'approved',
      review_note = 'verified recommendation',
      reviewed_by = '20000000-0000-4000-8000-000000000002'::uuid,
      reviewed_at = now(),
      approved_business_id = coalesce(r.approved_business_id, '50000000-0000-4000-8000-000000000001'::uuid)
  where r.id = '40000000-0000-4000-8000-000000000001'
    and r.status in ('pending','changes_requested')
  returning r.*
),
created_business as (
  insert into businesses (
    id, owner_user_id, category_id, kind, name, summary, description,
    service_area, status
  )
  select a.approved_business_id,
         null,
         (select bc.id from business_categories bc where bc.name = a.category_name and bc.is_active = true limit 1),
         'service', a.business_name, a.service_summary, a.service_summary,
         a.service_area, 'approved'
  from approved a
  on conflict (id) do nothing
  returning id
),
created_relation as (
  insert into business_complex_relations (
    business_id, complex_id, relation_type, verification_status,
    priority, verified_by, verified_at
  )
  select a.approved_business_id, a.complex_id, a.relation_type,
         'verified', 100, '20000000-0000-4000-8000-000000000002'::uuid, now()
  from approved a
  on conflict (business_id, complex_id) do update
    set relation_type = excluded.relation_type,
        verification_status = 'verified',
        verified_by = excluded.verified_by,
        verified_at = excluded.verified_at
  returning id
)
select id from approved;

do $$
declare
  owner_id uuid;
  relation text;
  verification text;
  approved_id uuid;
begin
  select owner_user_id into owner_id
  from businesses
  where id = '50000000-0000-4000-8000-000000000001';
  if owner_id is not null then
    raise exception 'recommended business must remain unowned, got owner %', owner_id;
  end if;

  select relation_type, verification_status into relation, verification
  from business_complex_relations
  where business_id = '50000000-0000-4000-8000-000000000001'
    and complex_id = '10000000-0000-4000-8000-000000000001';
  if relation <> 'neighbor' or verification <> 'verified' then
    raise exception 'recommendation relation materialization failed: relation=% verification=%', relation, verification;
  end if;

  select approved_business_id into approved_id
  from shop_recommendations
  where id = '40000000-0000-4000-8000-000000000001'
    and status = 'approved';
  if approved_id <> '50000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'approved business linkage failed: %', approved_id;
  end if;
end $$;
SQL

echo "PASS shop recommendation PostgreSQL lifecycle: non-owner materialization and verified relation"
