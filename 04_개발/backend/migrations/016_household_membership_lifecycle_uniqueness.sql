-- DanjiOn Household membership lifecycle uniqueness repair.
-- Preserve revoked membership rows as history while allowing later re-join.
-- Forward-only after 009; production application requires explicit approval.

alter table household_memberships
  drop constraint if exists household_memberships_complex_id_user_id_key;

alter table household_memberships
  drop constraint if exists household_memberships_household_id_user_id_key;

create unique index if not exists uq_household_membership_active_complex_user
  on household_memberships (complex_id, user_id)
  where status in ('pending','verified');

create unique index if not exists uq_household_membership_active_household_user
  on household_memberships (household_id, user_id)
  where status in ('pending','verified');

create index if not exists idx_household_membership_household_status
  on household_memberships (household_id, status, created_at desc);

comment on index uq_household_membership_active_complex_user is
  'One active/pending household association per user and complex; revoked rows remain historical.';

comment on index uq_household_membership_active_household_user is
  'One active/pending membership per user and household; revoked rows remain historical.';
