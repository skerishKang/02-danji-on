-- #257: official complex-news content is split into server-authoritative channels.
-- The frontend must never infer a channel from source_name/category; every post
-- carries a canonical channel value written here and enforced by the public posts
-- API (?channel= filter, 400 on unknown values).
alter table complex_posts add column if not exists channel text not null default 'apartment_news';

alter table complex_posts add constraint if not exists chk_complex_posts_channel
  check (channel in ('danjion_notice', 'apartment_news', 'management_office', 'chair_greeting'));

-- Backfill: 06 단지온공지 / 07 아파트소식(default) / 08 관리사무소 / 09 회장 인사말.
-- Existing rows are classified only by their authoritative source_name; the
-- 'channel = ''apartment_news''' guard keeps the backfill idempotent so explicit
-- future values are never overwritten.
update complex_posts set channel = 'danjion_notice'
  where channel = 'apartment_news' and source_name = '단지온 운영자';

update complex_posts set channel = 'management_office'
  where channel = 'apartment_news' and source_name = '관리사무소';

comment on column complex_posts.channel is
  'Server-authoritative official-news channel: danjion_notice|apartment_news|management_office|chair_greeting.';

-- DOWN:
-- alter table complex_posts drop constraint if exists chk_complex_posts_channel;
-- alter table complex_posts drop column if exists channel;
