#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
psql_cmd=(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q)

"${psql_cmd[@]}" -f migrations/001_initial_schema.sql
"${psql_cmd[@]}" -f migrations/009_household_foundation.sql
"${psql_cmd[@]}" -f migrations/013_community_core.sql
"${psql_cmd[@]}" -f migrations/017_account_lifecycle.sql
"${psql_cmd[@]}" -f migrations/024_resident_messages.sql
"${psql_cmd[@]}" -f migrations/027_business_reviews.sql
"${psql_cmd[@]}" -f migrations/034_resident_safety_reports.sql

"${psql_cmd[@]}" <<'SQL'
insert into complexes (id, slug, name, status) values
  ('20000000-0000-4000-8000-000000000001', 'safety-a', '안전단지 A', 'active'),
  ('20000000-0000-4000-8000-000000000002', 'safety-b', '안전단지 B', 'active');

insert into app_users (id, auth_user_id, display_name) values
  ('21000000-0000-4000-8000-000000000001', 'reporter', '신고자'),
  ('21000000-0000-4000-8000-000000000002', 'target-a', '대상주민'),
  ('21000000-0000-4000-8000-000000000003', 'peer-a', '다른주민'),
  ('21000000-0000-4000-8000-000000000004', 'target-b', '다른단지주민');

insert into complex_units (id, complex_id, building_code, unit_code) values
  ('22000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '101', '101'),
  ('22000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '101', '102'),
  ('22000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '101', '103'),
  ('22000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000002', '201', '201');

insert into households (id, complex_id, complex_unit_id) values
  ('23000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001'),
  ('23000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000002'),
  ('23000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000003'),
  ('23000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000004');

insert into household_memberships (complex_id, household_id, user_id, membership_role, status, verified_at) values
  ('20000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'primary', 'verified', now()),
  ('20000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000002', 'primary', 'verified', now()),
  ('20000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000003', '21000000-0000-4000-8000-000000000003', 'primary', 'verified', now()),
  ('20000000-0000-4000-8000-000000000002', '23000000-0000-4000-8000-000000000004', '21000000-0000-4000-8000-000000000004', 'primary', 'verified', now());

insert into conversations (id, complex_id, type, resident_pair_key) values
  ('24000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'resident', repeat('a', 73)),
  ('24000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'resident', repeat('b', 73));

insert into conversation_members (conversation_id, user_id) values
  ('24000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001'),
  ('24000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000002'),
  ('24000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000002'),
  ('24000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000003');

insert into messages (id, conversation_id, sender_user_id, body) values
  ('25000000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000002', '상대가 보낸 신고 가능 메시지'),
  ('25000000-0000-4000-8000-000000000002', '24000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '신고자 본인 메시지'),
  ('25000000-0000-4000-8000-000000000003', '24000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000002', '신고자가 참여하지 않은 대화 메시지');

insert into business_categories (id, slug, name) values
  ('26000000-0000-4000-8000-000000000001', 'safety-cat', '안전테스트');
insert into businesses (id, category_id, name, status) values
  ('27000000-0000-4000-8000-000000000001', '26000000-0000-4000-8000-000000000001', 'A 가게', 'approved'),
  ('27000000-0000-4000-8000-000000000002', '26000000-0000-4000-8000-000000000001', 'B 가게', 'approved');
insert into business_complex_relations (business_id, complex_id, relation_type, verification_status, verified_at) values
  ('27000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'local', 'verified', now()),
  ('27000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'local', 'verified', now());
insert into business_reviews (id, complex_id, business_id, author_user_id, body) values
  ('28000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000002', '다른 주민 후기'),
  ('28000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '내 후기'),
  ('28000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', '27000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000004', '다른 단지 후기');

-- Valid target classes.
insert into resident_safety_reports (id, complex_id, reporter_user_id, resident_user_id, reason)
values ('29000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000002', 'abuse');
insert into resident_safety_reports (id, complex_id, reporter_user_id, message_id, reason)
values ('29000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '25000000-0000-4000-8000-000000000001', 'threat');
insert into resident_safety_reports (id, complex_id, reporter_user_id, review_id, reason)
values ('29000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000001', 'spam');

-- Community reporting remains a separate canonical store.
insert into community_posts (id, complex_id, author_user_id, kind, title, body, status, published_at)
values ('2a000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000002', 'question', '테스트 글', '본문', 'published', now());
insert into community_reports (complex_id, reporter_user_id, post_id, reason)
values ('20000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '2a000000-0000-4000-8000-000000000001', 'other');

do $$
declare
  duplicate_failed boolean := false;
  self_resident_failed boolean := false;
  cross_resident_failed boolean := false;
  own_message_failed boolean := false;
  nonmember_message_failed boolean := false;
  own_review_failed boolean := false;
  cross_review_failed boolean := false;
  target_count_failed boolean := false;
  resolution_failed boolean := false;
begin
  begin
    insert into resident_safety_reports (complex_id, reporter_user_id, resident_user_id, reason)
    values ('20000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000002', 'other');
  exception when unique_violation then duplicate_failed := true;
  end;

  begin
    insert into resident_safety_reports (complex_id, reporter_user_id, resident_user_id, reason)
    values ('20000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'other');
  exception when raise_exception then self_resident_failed := true;
  end;

  begin
    insert into resident_safety_reports (complex_id, reporter_user_id, resident_user_id, reason)
    values ('20000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000004', 'other');
  exception when raise_exception then cross_resident_failed := true;
  end;

  begin
    insert into resident_safety_reports (complex_id, reporter_user_id, message_id, reason)
    values ('20000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '25000000-0000-4000-8000-000000000002', 'other');
  exception when raise_exception then own_message_failed := true;
  end;

  begin
    insert into resident_safety_reports (complex_id, reporter_user_id, message_id, reason)
    values ('20000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '25000000-0000-4000-8000-000000000003', 'other');
  exception when raise_exception then nonmember_message_failed := true;
  end;

  begin
    insert into resident_safety_reports (complex_id, reporter_user_id, review_id, reason)
    values ('20000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000002', 'other');
  exception when raise_exception then own_review_failed := true;
  end;

  begin
    insert into resident_safety_reports (complex_id, reporter_user_id, review_id, reason)
    values ('20000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000003', 'other');
  exception when raise_exception then cross_review_failed := true;
  end;

  begin
    insert into resident_safety_reports (complex_id, reporter_user_id, resident_user_id, message_id, reason)
    values ('20000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000002', '25000000-0000-4000-8000-000000000001', 'other');
  exception when check_violation then target_count_failed := true;
  end;

  begin
    update resident_safety_reports
    set status = 'resolved'
    where id = '29000000-0000-4000-8000-000000000001';
  exception when check_violation then resolution_failed := true;
  end;

  if not duplicate_failed then raise exception 'duplicate open resident report was not rejected'; end if;
  if not self_resident_failed then raise exception 'self resident report was not rejected'; end if;
  if not cross_resident_failed then raise exception 'cross-complex resident report was not rejected'; end if;
  if not own_message_failed then raise exception 'own message report was not rejected'; end if;
  if not nonmember_message_failed then raise exception 'nonmember message report was not rejected'; end if;
  if not own_review_failed then raise exception 'own review report was not rejected'; end if;
  if not cross_review_failed then raise exception 'cross-complex review report was not rejected'; end if;
  if not target_count_failed then raise exception 'multiple report targets were not rejected'; end if;
  if not resolution_failed then raise exception 'resolved state without operator/timestamp was not rejected'; end if;
end $$;

-- No content snapshot columns may creep into the persistent safety report row.
do $$
declare
  forbidden_columns integer;
  resident_reports integer;
  community_reports_count integer;
begin
  select count(*) into forbidden_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'resident_safety_reports'
    and column_name in ('message_body','review_body','target_snapshot','content_snapshot');
  if forbidden_columns <> 0 then
    raise exception 'resident safety report persistence contains forbidden content snapshot columns';
  end if;

  select count(*) into resident_reports from resident_safety_reports;
  select count(*) into community_reports_count from community_reports;
  if resident_reports <> 3 or community_reports_count <> 1 then
    raise exception 'report stores are not cleanly separated: resident %, community %', resident_reports, community_reports_count;
  end if;
end $$;
SQL

echo "PASS resident safety reports PostgreSQL lifecycle: target isolation, same-complex/access guards, duplicate convergence and no content snapshots"
