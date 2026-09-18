-- Isolated owner-preview #762 fixture. NEVER apply to Production.
-- Target: Neon QA child branch owner-preview-762 only.

alter table resident_public_profiles
  add column if not exists nickname_changed_at timestamptz;

with pilot_complex as (
  select id
  from complexes
  where slug = 'banglim-myeongji-roadhill'
  limit 1
),
unit_rows as (
  select
    pc.id as complex_id,
    building::text as building_code,
    (floor::text || lpad(unit_no::text, 2, '0')) as unit_code
  from pilot_complex pc
  cross join (values (101), (102)) as b(building)
  cross join generate_series(1,24) as f(floor)
  cross join generate_series(1,4) as u(unit_no)
)
insert into complex_units (complex_id, building_code, unit_code, status)
select complex_id, building_code, unit_code, 'active'
from unit_rows
on conflict (complex_id, building_code, unit_code) do update
set status = 'active', updated_at = now();

-- The legacy QA-only synthetic unit must not be offered in the owner-facing preview.
update complex_units cu
set status = 'inactive', updated_at = now()
from complexes c
where cu.complex_id = c.id
  and c.slug = 'banglim-myeongji-roadhill'
  and cu.building_code = 'qa-building'
  and cu.unit_code = 'qa-unit';

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from complex_units cu
  join complexes c on c.id = cu.complex_id
  where c.slug = 'banglim-myeongji-roadhill'
    and cu.status = 'active'
    and cu.building_code in ('101','102');

  if v_count <> 192 then
    raise exception 'OWNER_PREVIEW_UNIT_COUNT_MISMATCH expected=192 actual=%', v_count;
  end if;
end $$;
