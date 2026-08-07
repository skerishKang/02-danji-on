-- Development-only fixture for resident verification flows.
-- Do not apply in production.

with target_complex as (
  select id from complexes where slug = 'bangnim-myeongji-roadhill' limit 1
), upserted_user as (
  insert into app_users (auth_user_id, display_name)
  values ('dev-unverified-001', '미인증 주민')
  on conflict (auth_user_id) do update
    set display_name = excluded.display_name
  returning id
), resolved_user as (
  select id from upserted_user
  union all
  select id from app_users where auth_user_id = 'dev-unverified-001'
  limit 1
)
insert into complex_memberships (
  complex_id, user_id, role, verification_status, building, unit
)
select tc.id, ru.id, 'resident', 'unverified', null, null
from target_complex tc
cross join resolved_user ru
on conflict (complex_id, user_id) do update
  set role = 'resident',
      verification_status = 'unverified',
      building = null,
      unit = null,
      verified_at = null;
