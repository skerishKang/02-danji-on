#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
psql_cmd=(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q)

"${psql_cmd[@]}" -f migrations/001_initial_schema.sql

"${psql_cmd[@]}" <<'SQL'
insert into complexes (id, slug, name, status) values
  ('10000000-0000-4000-8000-000000000011', 'share-active-a', 'Share Active A', 'active'),
  ('10000000-0000-4000-8000-000000000012', 'share-active-b', 'Share Active B', 'active'),
  ('10000000-0000-4000-8000-000000000013', 'share-inactive', 'Share Inactive', 'inactive');

insert into businesses (id, kind, name, summary, description, status) values
  ('20000000-0000-4000-8000-000000000011', 'service', '공유가게 A', 'A', 'A', 'approved'),
  ('20000000-0000-4000-8000-000000000012', 'service', '공유가게 B', 'B', 'B', 'approved'),
  ('20000000-0000-4000-8000-000000000013', 'service', '미승인가게', 'P', 'P', 'pending'),
  ('20000000-0000-4000-8000-000000000014', 'service', '비활성단지가게', 'I', 'I', 'approved');

-- This relation predates migration 032 and must be backfilled.
insert into business_complex_relations (
  id, business_id, complex_id, relation_type, verification_status, priority
) values (
  '30000000-0000-4000-8000-000000000011',
  '20000000-0000-4000-8000-000000000011',
  '10000000-0000-4000-8000-000000000011',
  'resident', 'verified', 10
);
SQL

"${psql_cmd[@]}" -f migrations/032_business_share_slug.sql

"${psql_cmd[@]}" <<'SQL'
-- New relations after migration must receive a slug from the default.
insert into business_complex_relations (
  id, business_id, complex_id, relation_type, verification_status, priority
) values
  ('30000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000011', 'neighbor', 'verified', 20),
  ('30000000-0000-4000-8000-000000000013', '20000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000011', 'local', 'verified', 30),
  ('30000000-0000-4000-8000-000000000014', '20000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000013', 'local', 'verified', 40);

do $$
declare
  backfilled text;
  generated text;
  before_rename text;
  after_rename text;
  duplicate_failed boolean := false;
  immutable_failed boolean := false;
begin
  select share_slug into backfilled
  from business_complex_relations
  where id = '30000000-0000-4000-8000-000000000011'::uuid;

  select share_slug into generated
  from business_complex_relations
  where id = '30000000-0000-4000-8000-000000000012'::uuid;

  if backfilled is null or backfilled !~ '^shop-[0-9a-f]{24}$' then
    raise exception 'pre-existing relation was not backfilled correctly: %', backfilled;
  end if;
  if generated is null or generated !~ '^shop-[0-9a-f]{24}$' then
    raise exception 'new relation did not receive generated share slug: %', generated;
  end if;
  if backfilled = generated then
    raise exception 'distinct relations unexpectedly received same random share slug';
  end if;

  -- Same literal slug is allowed in a different complex because the public route includes complexSlug.
  insert into business_complex_relations (
    id, business_id, complex_id, relation_type, verification_status, priority, share_slug
  ) values (
    '30000000-0000-4000-8000-000000000015',
    '20000000-0000-4000-8000-000000000011',
    '10000000-0000-4000-8000-000000000012',
    'local', 'verified', 50, backfilled
  );

  begin
    insert into business_complex_relations (
      id, business_id, complex_id, relation_type, verification_status, priority, share_slug
    ) values (
      '30000000-0000-4000-8000-000000000016',
      '20000000-0000-4000-8000-000000000014',
      '10000000-0000-4000-8000-000000000011',
      'local', 'verified', 60, backfilled
    );
  exception when unique_violation then
    duplicate_failed := true;
  end;
  if not duplicate_failed then
    raise exception 'same-complex duplicate share slug was not rejected';
  end if;

  begin
    update business_complex_relations
    set share_slug = 'shop-aaaaaaaaaaaaaaaaaaaaaaaa'
    where id = '30000000-0000-4000-8000-000000000011'::uuid;
  exception when others then
    if position('immutable' in sqlerrm) > 0 then
      immutable_failed := true;
    else
      raise;
    end if;
  end;
  if not immutable_failed then
    raise exception 'share slug mutation was not rejected';
  end if;

  select share_slug into before_rename
  from business_complex_relations
  where id = '30000000-0000-4000-8000-000000000011'::uuid;
  update businesses set name = '공유가게 A 이름변경' where id = '20000000-0000-4000-8000-000000000011'::uuid;
  select share_slug into after_rename
  from business_complex_relations
  where id = '30000000-0000-4000-8000-000000000011'::uuid;
  if before_rename <> after_rename then
    raise exception 'business rename changed stable share slug';
  end if;
end $$;

-- Resolver visibility boundary: only active/pilot complex + approved business + verified relation.
do $$
declare
  visible_count integer;
  pending_count integer;
  inactive_count integer;
begin
  select count(*) into visible_count
  from business_complex_relations r
  join businesses b on b.id = r.business_id
  join complexes c on c.id = r.complex_id
  where c.slug = 'share-active-a'
    and c.status in ('active','pilot')
    and b.status = 'approved'
    and r.verification_status = 'verified';
  if visible_count <> 2 then
    raise exception 'unexpected public resolver-visible relation count: %', visible_count;
  end if;

  select count(*) into pending_count
  from business_complex_relations r
  join businesses b on b.id = r.business_id
  join complexes c on c.id = r.complex_id
  where c.slug = 'share-active-a'
    and b.id = '20000000-0000-4000-8000-000000000013'::uuid
    and c.status in ('active','pilot')
    and b.status = 'approved'
    and r.verification_status = 'verified';
  if pending_count <> 0 then
    raise exception 'pending business incorrectly resolves publicly';
  end if;

  select count(*) into inactive_count
  from business_complex_relations r
  join businesses b on b.id = r.business_id
  join complexes c on c.id = r.complex_id
  where c.slug = 'share-inactive'
    and c.status in ('active','pilot')
    and b.status = 'approved'
    and r.verification_status = 'verified';
  if inactive_count <> 0 then
    raise exception 'inactive complex incorrectly resolves publicly';
  end if;
end $$;
SQL

echo "PASS business share PostgreSQL lifecycle: backfill/default, complex-scoped uniqueness, immutability, rename stability and public visibility boundary"
