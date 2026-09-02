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
"${psql_cmd[@]}" -f migrations/024_resident_messages.sql
"${psql_cmd[@]}" -f migrations/025_resident_notifications.sql
"${psql_cmd[@]}" -f migrations/030_inquiries.sql

"${psql_cmd[@]}" <<'SQL'
insert into complexes (id, slug, name, status) values
  ('10000000-0000-4000-8000-000000000001', 'complex-one', 'Complex One', 'active');

insert into app_users (id, auth_user_id, display_name) values
  ('20000000-0000-4000-8000-000000000001', 'resident-a', 'Resident A'),
  ('20000000-0000-4000-8000-000000000002', 'operator-b', 'Operator B');

insert into inquiries (
  id, complex_id, user_id, inquiry_type, title, body
) values (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'general', 'Need help', 'Private inquiry body'
);
SQL

expect_fail \
  "answered state without response rejected" \
  "update inquiries set status='answered', answered_at=now() where id='30000000-0000-4000-8000-000000000001'"

"${psql_cmd[@]}" <<'SQL'
update inquiries
set status = 'in_progress'
where id = '30000000-0000-4000-8000-000000000001'
  and status = 'received';

update inquiries
set status = 'answered',
    response_text = 'Operator response',
    answered_by = '20000000-0000-4000-8000-000000000002',
    answered_at = now()
where id = '30000000-0000-4000-8000-000000000001'
  and status = 'in_progress';

insert into notifications (
  user_id, complex_id, type, actor_user_id, resource_type, resource_id, source_event_key, title
)
select user_id, complex_id, 'inquiry_answer', '20000000-0000-4000-8000-000000000002'::uuid,
       'inquiry', id, 'inquiry-answer:' || id::text, '문의 답변이 등록되었습니다'
from inquiries
where id = '30000000-0000-4000-8000-000000000001' and status = 'answered'
on conflict (user_id, source_event_key) where source_event_key is not null do nothing;

-- Replay must not duplicate the notification.
insert into notifications (
  user_id, complex_id, type, actor_user_id, resource_type, resource_id, source_event_key, title
)
select user_id, complex_id, 'inquiry_answer', '20000000-0000-4000-8000-000000000002'::uuid,
       'inquiry', id, 'inquiry-answer:' || id::text, '문의 답변이 등록되었습니다'
from inquiries
where id = '30000000-0000-4000-8000-000000000001' and status = 'answered'
on conflict (user_id, source_event_key) where source_event_key is not null do nothing;

update inquiries
set status = 'closed', closed_at = now()
where id = '30000000-0000-4000-8000-000000000001'
  and status = 'answered';

do $$
declare
  inquiry_status text;
  answer text;
  notification_count integer;
  notification_title text;
  notification_type text;
  resource_type_value text;
  resource_id_value uuid;
begin
  select status, response_text into inquiry_status, answer
  from inquiries
  where id = '30000000-0000-4000-8000-000000000001';
  if inquiry_status <> 'closed' or answer <> 'Operator response' then
    raise exception 'inquiry lifecycle failed: status=% response=%', inquiry_status, answer;
  end if;

  select count(*) into notification_count
  from notifications
  where user_id = '20000000-0000-4000-8000-000000000001'
    and source_event_key = 'inquiry-answer:30000000-0000-4000-8000-000000000001';
  if notification_count <> 1 then
    raise exception 'expected one idempotent inquiry notification, got %', notification_count;
  end if;

  select title, type, resource_type, resource_id
  into notification_title, notification_type, resource_type_value, resource_id_value
  from notifications
  where source_event_key = 'inquiry-answer:30000000-0000-4000-8000-000000000001';
  if notification_title in ('Private inquiry body','Operator response') then
    raise exception 'private inquiry content leaked to notification title';
  end if;
  if notification_type <> 'inquiry_answer' or resource_type_value <> 'inquiry'
     or resource_id_value <> '30000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'inquiry notification linkage failed';
  end if;
end $$;
SQL

echo "PASS inquiry PostgreSQL lifecycle: state constraints, answer notification idempotency, no body/response copy"
