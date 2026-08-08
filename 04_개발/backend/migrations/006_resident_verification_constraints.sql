-- DanjiOn resident verification schema additions and domain constraints.
-- This migration must be executable on a fresh database after 001-005.

alter table complex_memberships
  add column if not exists building text,
  add column if not exists unit text;

alter table resident_verifications
  add column if not exists requested_at timestamptz not null default now(),
  add column if not exists note text;

-- The resident verification API upserts one current verification row per membership.
create unique index if not exists uq_resident_verifications_membership
  on resident_verifications (membership_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_membership_building_length') then
    alter table complex_memberships
      add constraint chk_membership_building_length
      check (building is null or char_length(building) between 1 and 20);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'chk_membership_unit_length') then
    alter table complex_memberships
      add constraint chk_membership_unit_length
      check (unit is null or char_length(unit) between 1 and 20);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'chk_resident_verification_method') then
    alter table resident_verifications
      add constraint chk_resident_verification_method
      check (method in ('document','management_confirmation','manual'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'chk_resident_verification_evidence_key_length') then
    alter table resident_verifications
      add constraint chk_resident_verification_evidence_key_length
      check (evidence_object_key is null or char_length(evidence_object_key) <= 500);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'chk_resident_verification_note_length') then
    alter table resident_verifications
      add constraint chk_resident_verification_note_length
      check (note is null or char_length(note) <= 1000);
  end if;
end $$;
