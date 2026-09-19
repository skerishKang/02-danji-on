-- DanjiOn complex_units authoritative master provenance.
-- Issue #776: records operator mutation provenance and deactivation timestamp
-- without altering historical rows or introducing resident PII.

alter table complex_units
  add column if not exists created_by_user_id uuid null references app_users(id) on delete set null,
  add column if not exists updated_by_user_id uuid null references app_users(id) on delete set null,
  add column if not exists deactivated_at timestamptz null;

comment on column complex_units.created_by_user_id is
  'PADIEM operator who created the canonical unit record, null for historical foundation rows.';
comment on column complex_units.updated_by_user_id is
  'PADIEM operator who last modified the canonical unit record, null for historical foundation rows.';
comment on column complex_units.deactivated_at is
  'Timestamp when the canonical unit was transitioned from active to inactive, null for active units.';
