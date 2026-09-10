#!/usr/bin/env bash
# Report R-B: migration 046 PostgreSQL lifecycle.
# Proves 046 applies against real PostgreSQL: first apply, rerun idempotency,
# legacy nullability, R-B column bounds, FK enforcement, raw backfill, the
# forbidden nearby pre-resolve staying unresolved, and the resolved-only
# atomic approval (business + verified relation + linkage) with fail-closed
# no-ops for unresolved rows. Requires DATABASE_URL pointing at a
# NON-PRODUCTION scratch database. Never run against production.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required (scratch database only)}"
psql_cmd=(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q)

expect_fail() {
  local label="$1"
  local statement="$2"
  local out
  out="$(mktemp)"
  if "${psql_cmd[@]}" -c "$statement" >"$out" 2>&1; then
    echo "FAIL ${label}: statement unexpectedly succeeded"
    cat "$out"
    rm -f "$out"
    exit 1
  fi
  rm -f "$out"
  echo "PASS ${label}"
}

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

# ------------------------------------------------------------------ 1. apply
"${psql_cmd[@]}" -f migrations/001_initial_schema.sql
"${psql_cmd[@]}" -f migrations/029_shop_recommendations.sql
echo "PASS 029 base applies"

# ------------------------------------------------------------------ 2. seed legacy history before 046
"${psql_cmd[@]}" <<'SQL'
insert into complexes (id, slug, name, status) values
  ('60000000-0000-4000-8000-000000000001', 'rb-complex', 'RB Complex', 'active')
on conflict (id) do nothing;
insert into app_users (id, auth_user_id, display_name) values
  ('61000000-0000-4000-8000-000000000001', 'rb-reporter', 'RB Reporter'),
  ('62000000-0000-4000-8000-000000000001', 'rb-operator', 'RB Operator')
on conflict (id) do nothing;
insert into business_categories (id, slug, name, is_active) values
  ('63000000-0000-4000-8000-000000000001', 'rb-food', 'RB Food', true),
  ('63100000-0000-4000-8000-000000000001', 'rb-closed', 'RB Closed', false)
on conflict (id) do nothing;
insert into shop_recommendations (
  id, complex_id, reporter_user_id, relation_type, business_name,
  category_name, service_summary
) values (
  '64000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001',
  'neighbor', 'Legacy Shop', 'RB Food', 'Legacy recommendation'
)
on conflict (id) do nothing;
SQL
echo "PASS legacy history seeded under 029"

"${psql_cmd[@]}" -f migrations/046_report_rb_schema.sql
echo "PASS 046 first apply exits 0"
"${psql_cmd[@]}" -f migrations/046_report_rb_schema.sql
echo "PASS 046 rerun is idempotent"

expect_scalar 'legacy raw backfilled from relation_type' \
  'neighbor' \
  "select reported_relation_raw from shop_recommendations where id = '64000000-0000-4000-8000-000000000001'"

# ------------------------------------------------------------------ 3. bounds
"${psql_cmd[@]}" <<'SQL'
-- nullable legacy intake: a nearby report with no canonical category
insert into shop_recommendations (
  id, complex_id, reporter_user_id, relation_type, reported_relation_raw,
  resolved_relation_type, relation_detail, business_name, category_name,
  resolved_category_id, service_summary, service_area, report_price, report_hours
) values (
  '64200000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001',
  null, 'nearby', null, null, 'Nearby Shop', null,
  null, 'Nearby recommendation', 'Near gate', '5,000', '09-18'
)
on conflict (id) do nothing;
-- resolved family report with an active canonical category
insert into shop_recommendations (
  id, complex_id, reporter_user_id, relation_type, reported_relation_raw,
  resolved_relation_type, relation_detail, business_name, category_name,
  resolved_category_id, service_summary
) values (
  '64100000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001',
  'resident_family', 'family', 'resident_family', null, 'Family Shop', 'RB Food',
  '63000000-0000-4000-8000-000000000001', 'Family recommendation'
)
on conflict (id) do nothing;
-- etc report keeps raw + detail with resolved NULL
insert into shop_recommendations (
  id, complex_id, reporter_user_id, reported_relation_raw,
  resolved_relation_type, relation_detail, business_name, service_summary
) values (
  '64300000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001',
  'etc', null, 'friend of a friend', 'Etc Shop', 'Etc recommendation'
)
on conflict (id) do nothing;
SQL
echo "PASS R-B rows insert with nullable legacy fields"

expect_fail \
  "owner relation rejected in recommendation lane" \
  "insert into shop_recommendations (complex_id,reporter_user_id,relation_type,business_name,service_summary) values ('60000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','resident','Bad','Bad relation')"

expect_fail \
  "unbounded resolved relation rejected" \
  "insert into shop_recommendations (complex_id,reporter_user_id,reported_relation_raw,resolved_relation_type,business_name,service_summary) values ('60000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','owner','owner','Bad','Bad relation')"

expect_fail \
  "dangling resolved category rejected by FK" \
  "insert into shop_recommendations (complex_id,reporter_user_id,reported_relation_raw,resolved_relation_type,business_name,service_summary,resolved_category_id) values ('60000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','neighbor','neighbor','Bad','Bad relation','66000000-0000-4000-8000-000000000001')"

# ------------------------------------------------------------------ 4. resolved approval (family row)
"${psql_cmd[@]}" <<'SQL'
with approved as (
  update shop_recommendations r
  set status = 'approved',
      review_note = 'verified R-B report',
      reviewed_by = '62000000-0000-4000-8000-000000000001'::uuid,
      reviewed_at = now(),
      approved_business_id = coalesce(r.approved_business_id, '65000000-0000-4000-8000-000000000001'::uuid)
  where r.id = '64100000-0000-4000-8000-000000000001'
    and r.complex_id = '60000000-0000-4000-8000-000000000001'::uuid
    and r.status in ('pending','changes_requested')
    and r.resolved_category_id is not null
    and r.resolved_relation_type is not null
    and exists (
      select 1 from business_categories bc
      where bc.id = r.resolved_category_id
        and bc.is_active = true
    )
  returning r.*
),
created_business as (
  insert into businesses (
    id, owner_user_id, category_id, kind, name, summary, description,
    service_area, status
  )
  select a.approved_business_id,
         null,
         a.resolved_category_id,
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
  select a.approved_business_id, a.complex_id, a.resolved_relation_type,
         'verified', 100, '62000000-0000-4000-8000-000000000001'::uuid, now()
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
  category_id uuid;
  relation text;
  verification text;
  approved_id uuid;
begin
  select owner_user_id, category_id into owner_id, category_id
  from businesses
  where id = '65000000-0000-4000-8000-000000000001';
  if owner_id is not null then
    raise exception 'recommended business must remain unowned, got owner %', owner_id;
  end if;
  if category_id <> '63000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'approved business must carry resolved_category_id, got %', category_id;
  end if;

  select relation_type, verification_status into relation, verification
  from business_complex_relations
  where business_id = '65000000-0000-4000-8000-000000000001'
    and complex_id = '60000000-0000-4000-8000-000000000001';
  if relation <> 'resident_family' or verification <> 'verified' then
    raise exception 'resolved relation materialization failed: relation=% verification=%', relation, verification;
  end if;

  select approved_business_id into approved_id
  from shop_recommendations
  where id = '64100000-0000-4000-8000-000000000001'
    and status = 'approved';
  if approved_id <> '65000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'approved business linkage failed: %', approved_id;
  end if;
end $$;
SQL
echo "PASS resolved R-B approval materializes business, relation, and linkage"

# ------------------------------------------------------------------ 5. fail-closed (nearby row: resolved NULL)
"${psql_cmd[@]}" <<'SQL'
with approved as (
  update shop_recommendations r
  set status = 'approved',
      reviewed_by = '62000000-0000-4000-8000-000000000001'::uuid,
      reviewed_at = now(),
      approved_business_id = coalesce(r.approved_business_id, '65100000-0000-4000-8000-000000000001'::uuid)
  where r.id = '64200000-0000-4000-8000-000000000001'
    and r.complex_id = '60000000-0000-4000-8000-000000000001'::uuid
    and r.status in ('pending','changes_requested')
    and r.resolved_category_id is not null
    and r.resolved_relation_type is not null
    and exists (
      select 1 from business_categories bc
      where bc.id = r.resolved_category_id
        and bc.is_active = true
    )
  returning r.*
),
created_business as (
  insert into businesses (
    id, owner_user_id, category_id, kind, name, summary, description,
    service_area, status
  )
  select a.approved_business_id,
         null,
         a.resolved_category_id,
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
  select a.approved_business_id, a.complex_id, a.resolved_relation_type,
         'verified', 100, '62000000-0000-4000-8000-000000000001'::uuid, now()
  from approved a
  on conflict (business_id, complex_id) do update
    set relation_type = excluded.relation_type,
        verification_status = 'verified',
        verified_by = excluded.verified_by,
        verified_at = excluded.verified_at
  returning id
)
select id from approved;
SQL

expect_scalar 'unresolved nearby report stays pending (fail-closed)' \
  'pending' \
  "select status from shop_recommendations where id = '64200000-0000-4000-8000-000000000001'"

expect_scalar 'unresolved nearby report creates no business (fail-closed)' \
  '0' \
  "select count(*) from businesses where id = '65100000-0000-4000-8000-000000000001'"

expect_scalar 'nearby raw is preserved verbatim' \
  'nearby' \
  "select reported_relation_raw from shop_recommendations where id = '64200000-0000-4000-8000-000000000001'"

expect_scalar 'etc raw and detail are preserved with resolved NULL' \
  'etc|friend of a friend|' \
  "select reported_relation_raw || '|' || relation_detail || '|' || coalesce(resolved_relation_type, '') from shop_recommendations where id = '64300000-0000-4000-8000-000000000001'"

echo "PASS report R-B PostgreSQL lifecycle: resolved approval and fail-closed unresolved"
