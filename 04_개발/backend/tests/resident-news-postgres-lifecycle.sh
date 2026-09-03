#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
psql_cmd=(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q)

expect_fail() {
  local label="$1"
  local statement="$2"
  local out
  out="$(mktemp)"
  if "${psql_cmd[@]}" -c "$statement" >"$out" 2>&1; then
    echo "FAIL $label: statement unexpectedly succeeded"
    cat "$out"
    rm -f "$out"
    exit 1
  fi
  rm -f "$out"
  echo "PASS $label"
}

"${psql_cmd[@]}" -f migrations/001_initial_schema.sql
"${psql_cmd[@]}" -f migrations/009_household_foundation.sql
"${psql_cmd[@]}" -f migrations/024_resident_messages.sql
"${psql_cmd[@]}" -f migrations/025_resident_notifications.sql
"${psql_cmd[@]}" -f migrations/036_resident_news.sql

"${psql_cmd[@]}" <<'SQL'
insert into complexes (id, slug, name, status) values
  ('10000000-0000-4000-8000-000000000001', 'complex-1', 'Complex One', 'active'),
  ('10000000-0000-4000-8000-000000000002', 'complex-2', 'Complex Two', 'active');

insert into app_users (id, auth_user_id, display_name) values
  ('20000000-0000-4000-8000-000000000001', 'resident-a', 'Resident A'),
  ('20000000-0000-4000-8000-000000000002', 'resident-b', 'Resident B'),
  ('20000000-0000-4000-8000-000000000003', 'pending-c', 'Pending C'),
  ('20000000-0000-4000-8000-000000000004', 'operator-d', 'Operator D');

insert into complex_units (id, complex_id, building_code, unit_code) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'B1', 'U1'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'B2', 'U2');

insert into households (id, complex_id, complex_unit_id) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002');

insert into household_memberships (id, complex_id, household_id, user_id, membership_role, status, verified_at) values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'primary', 'verified', now()),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'member', 'verified', now()),
  ('50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003', 'member', 'pending', null);

insert into resident_news_submissions (
  id, complex_id, submitter_user_id, title, body
) values (
  '60000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'Original resident submission',
  'PRIVATE SUBMISSION BODY MUST NOT BE COPIED INTO NOTIFICATIONS'
);

do $$
declare
  post_count integer;
  notification_count integer;
begin
  select count(*) into post_count from resident_news_posts;
  select count(*) into notification_count from notifications;
  if post_count <> 0 then raise exception 'submission leaked into publication store'; end if;
  if notification_count <> 0 then raise exception 'submission created premature notifications'; end if;
end $$;

-- Simulate the operator approval transaction: preserve source and create a separate publication.
insert into resident_news_posts (
  id, complex_id, source_submission_id, title, body
) values (
  '70000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  'Verified resident news',
  'Published copy may differ from the original submission'
);

update resident_news_submissions
set status = 'approved', review_note = 'verified by operator',
    reviewed_by_user_id = '20000000-0000-4000-8000-000000000004', reviewed_at = now()
where id = '60000000-0000-4000-8000-000000000001';

insert into resident_news_review_events (
  complex_id, submission_id, operator_user_id, action, note
) values (
  '10000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000004',
  'approved',
  'verified by operator'
);

do $$
declare
  notification_count integer;
  a_count integer;
  b_count integer;
  pending_count integer;
  leaked integer;
  review_count integer;
  post_title text;
  original_title text;
begin
  select count(*) into notification_count from notifications;
  if notification_count <> 2 then
    raise exception 'expected exactly two verified-resident notifications, got %', notification_count;
  end if;

  select count(*) into a_count from notifications where user_id = '20000000-0000-4000-8000-000000000001';
  select count(*) into b_count from notifications where user_id = '20000000-0000-4000-8000-000000000002';
  select count(*) into pending_count from notifications where user_id = '20000000-0000-4000-8000-000000000003';
  if a_count <> 1 or b_count <> 1 or pending_count <> 0 then
    raise exception 'Household-v2 fanout mismatch A=% B=% pending=%', a_count, b_count, pending_count;
  end if;

  select count(*) into leaked
  from notifications
  where title like '%PRIVATE SUBMISSION BODY%'
     or source_event_key <> 'resident-news:70000000-0000-4000-8000-000000000001'
     or resource_type <> 'resident_news'
     or resource_id <> '70000000-0000-4000-8000-000000000001'::uuid;
  if leaked <> 0 then raise exception 'notification privacy/resource linkage failed'; end if;

  select count(*) into review_count
  from resident_news_review_events
  where submission_id = '60000000-0000-4000-8000-000000000001'::uuid and action = 'approved';
  if review_count <> 1 then raise exception 'approval audit event missing'; end if;

  select title into post_title from resident_news_posts where id = '70000000-0000-4000-8000-000000000001';
  select title into original_title from resident_news_submissions where id = '60000000-0000-4000-8000-000000000001';
  if post_title = original_title then raise exception 'test must prove source/publication rows can diverge'; end if;
end $$;
SQL

expect_fail \
  "one publication per submission" \
  "insert into resident_news_posts (complex_id, source_submission_id, title, body) values ('10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'duplicate', 'duplicate')"

expect_fail \
  "publication cannot cross complex boundary" \
  "insert into resident_news_submissions (id, complex_id, submitter_user_id, title, body) values ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'cross', 'cross'); insert into resident_news_posts (complex_id, source_submission_id, title, body) values ('10000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002', 'cross', 'cross')"

echo "PASS resident-news PostgreSQL lifecycle: isolated submission/publication, approval audit, Household-v2 notification fanout, no body copy, dedupe and tenant FK"
