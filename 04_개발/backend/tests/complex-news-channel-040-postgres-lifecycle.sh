#!/usr/bin/env bash
# #257/#278: migration 040 PostgreSQL compatibility lifecycle.
# The merged 040 used `ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS`, which
# PostgreSQL does not support. This lifecycle proves the fixed 040 executes
# against real PostgreSQL: first apply, rerun (idempotency), backfill
# correctness, check-constraint enforcement, and the fail-closed path for an
# incompatible existing constraint. It also proves the 040 -> 041 -> 042
# production apply sequence.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
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

apply_base_schema() {
  # Smallest faithful base for 040: 001 defines complex_posts and the whole
  # production application schema 040 depends on. Production additionally has
  # 002..039, none of which alter complex_posts; 040 only touches that table,
  # so 001 + 040 reproduces the relevant state faithfully.
  "${psql_cmd[@]}" -f migrations/001_initial_schema.sql
}

# ---------------------------------------------------------------- 1. first apply
apply_base_schema
"${psql_cmd[@]}" -f migrations/040_complex_news_channel.sql
echo "PASS 040 first apply exits 0"

# column exists, type/nullability/default
expect_scalar 'channel column exists with not-null default' \
  'text|t|apartment_news' \
  "select data_type || '|' || is_nullable || '|' || column_default
   from information_schema.columns
   where table_name = 'complex_posts' and column_name = 'channel'"

# check constraint exists and is enforced on this table
expect_scalar 'chk_complex_posts_channel constraint exists' \
  'chk_complex_posts_channel' \
  "select conname from pg_constraint
   where conname = 'chk_complex_posts_channel'
     and conrelid = 'complex_posts'::regclass"

# ---------------------------------------------------------------- 2. constraint behavior
# allowed values accepted / invalid value rejected
"${psql_cmd[@]}" <<'SQL'
insert into complexes (id, slug, name, status) values
  ('10000000-0000-4000-8000-000000000001', 'complex-1', 'Complex One', 'active');
insert into complex_posts (id, complex_id, source_name, category, title, body, status, published_at) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '단지온 운영자', 'notice', 't1', 'b', 'published', now()),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '관리사무소', 'notice', 't2', 'b', 'published', now()),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '다른 출처', 'notice', 't3', 'b', 'published', now()),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '단지온 운영자', 'notice', 't4', 'b', 'published', now());
SQL

# all four allowed channel values accepted by the check constraint
"${psql_cmd[@]}" <<'SQL' >/dev/null
insert into complex_posts (id, complex_id, source_name, category, title, body, status, channel, published_at) values
  ('30000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000001', 'x', 'notice', 'ok', 'b', 'published', 'danjion_notice', now()),
  ('30000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000001', 'x', 'notice', 'ok', 'b', 'published', 'apartment_news', now()),
  ('30000000-0000-4000-8000-000000000103', '10000000-0000-4000-8000-000000000001', 'x', 'notice', 'ok', 'b', 'published', 'management_office', now()),
  ('30000000-0000-4000-8000-000000000104', '10000000-0000-4000-8000-000000000001', 'x', 'notice', 'ok', 'b', 'published', 'chair_greeting', now());
SQL
echo "PASS all four channels accepted by check constraint"

expect_fail 'invalid channel value rejected by check constraint' \
  "insert into complex_posts (id, complex_id, source_name, category, title, body, status, channel, published_at) values
     ('30000000-0000-4000-8000-000000000201', '10000000-0000-4000-8000-000000000001', 'x', 'notice', 'bad', 'b', 'published', 'not_a_channel', now())"

# ---------------------------------------------------------------- 3. backfill
# Rows were inserted AFTER the migration first ran, so they still carry the
# 'apartment_news' default for matching source_names. The rerun below is what
# actually backfills them (idempotent guarded UPDATEs) — proving both the
# backfill semantics and rerun idempotency together.

# ---------------------------------------------------------------- 4. rerun idempotency
# set an explicit non-default channel to prove rerun never overwrites it
"${psql_cmd[@]}" -c "update complex_posts set channel = 'chair_greeting' where id = '30000000-0000-4000-8000-000000000004'::uuid" >/dev/null
"${psql_cmd[@]}" -f migrations/040_complex_news_channel.sql
echo "PASS 040 rerun exits 0"

expect_scalar 'backfill: 단지온 운영자 => danjion_notice' \
  'danjion_notice' \
  "select channel from complex_posts where id = '30000000-0000-4000-8000-000000000001'::uuid"

expect_scalar 'backfill: 관리사무소 => management_office' \
  'management_office' \
  "select channel from complex_posts where id = '30000000-0000-4000-8000-000000000002'::uuid"

expect_scalar 'unrelated source remains apartment_news default' \
  'apartment_news' \
  "select channel from complex_posts where id = '30000000-0000-4000-8000-000000000003'::uuid"

expect_scalar 'rerun preserves data and explicit channel values' \
  'chair_greeting' \
  "select channel from complex_posts where id = '30000000-0000-4000-8000-000000000004'::uuid"

expect_scalar 'rerun preserves backfilled values' \
  'danjion_notice' \
  "select channel from complex_posts where id = '30000000-0000-4000-8000-000000000001'::uuid"

expect_scalar 'rerun leaves exactly one constraint (no duplicate)' \
  '1' \
  "select count(*) from pg_constraint
   where conname = 'chk_complex_posts_channel'
     and conrelid = 'complex_posts'::regclass"

# ---------------------------------------------------------------- 5. incompatible existing constraint => fail closed
# The migration must never silently drop/recreate a same-named constraint with
# an incompatible definition. Reproduce the pre-migration state where a
# DIFFERENT definition already owns the name: a name-owning constraint whose
# definition differs from 040's intended channel check. Running 040 must NOT
# drop or recreate it — the DO guard skips, the definition stays incompatible,
# and application tooling must STOP for manual intervention.
"${psql_cmd[@]}" <<'SQL' >/dev/null
drop table complex_posts cascade;
-- fresh table WITHOUT the 040 channel column; pre-create a same-named
-- constraint with an incompatible (title-based) definition
create table complex_posts (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  author_user_id uuid references app_users(id) on delete set null,
  source_name text not null,
  category text not null,
  title text not null,
  body text not null,
  attachment_object_key text,
  status text not null default 'published' check (status in ('draft','published','archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table complex_posts add constraint chk_complex_posts_channel
  check (char_length(title) <= 200);
SQL
"${psql_cmd[@]}" -f migrations/040_complex_news_channel.sql
constraint_def="$("${psql_cmd[@]}" -At -c "select pg_get_constraintdef(oid) from pg_constraint where conname = 'chk_complex_posts_channel' and conrelid = 'complex_posts'::regclass")"
if echo "$constraint_def" | grep -q "channel in ('danjion_notice', 'apartment_news', 'management_office', 'chair_greeting')"; then
  echo "FAIL incompatible-existing-constraint path: migration silently recreated the definition"
  exit 1
fi
if echo "$constraint_def" | grep -q "char_length(title)"; then
  echo "PASS INCOMPATIBLE_EXISTING_CONSTRAINT => migration left it untouched; application must STOP for manual intervention"
else
  echo "FAIL unexpected constraint definition after run: $constraint_def"
  exit 1
fi

# restore a clean compatible state for the sequence test
"${psql_cmd[@]}" <<'SQL' >/dev/null
drop table complex_posts cascade;
create table complex_posts (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  author_user_id uuid references app_users(id) on delete set null,
  source_name text not null,
  category text not null,
  title text not null,
  body text not null,
  attachment_object_key text,
  status text not null default 'published' check (status in ('draft','published','archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
SQL
"${psql_cmd[@]}" -f migrations/040_complex_news_channel.sql
echo "PASS 040 re-apply on compatible clean state"

# ---------------------------------------------------------------- 6. 040 -> 041 -> 042 production sequence
"${psql_cmd[@]}" -f migrations/041_business_category_benefit_contract.sql
echo "PASS 041 contract apply after fixed 040"

"${psql_cmd[@]}" -f migrations/042_seed_banglim_pilot_production.sql
echo "PASS 042 seed apply after 041"

expect_scalar 'post-042: complexes = 1' '1' \
  "select count(*) from complexes where slug = 'banglim-myeongji-roadhill'"
expect_scalar 'post-042: businesses = 8' '8' \
  "select count(*) from businesses where id::text like 'd0a1c4a1-41c5-4c51-b2b2-%'"
expect_scalar 'post-042: business_complex_relations = 8' '8' \
  "select count(*) from business_complex_relations where business_id::text like 'd0a1c4a1-41c5-4c51-b2b2-%'"
expect_scalar 'post-042: business_category_relations = 10' '10' \
  "select count(*) from business_category_relations where business_id::text like 'd0a1c4a1-41c5-4c51-b2b2-%'"
expect_scalar 'post-042: benefits = 8' '8' \
  "select count(*) from benefits where id::text like 'd0a1c4a1-41c5-4c51-a1b1-%'"
expect_scalar 'post-042: benefit value+code 8/8' '8' \
  "select count(*) from benefits where id::text like 'd0a1c4a1-41c5-4c51-a1b1-%'
     and value_text is not null and code is not null"

echo 'PASS #278 040 compatibility + 040->041->042 sequence lifecycle'
