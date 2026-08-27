-- DanjiOn business-image background reconciliation lease/retry metadata.
-- Extends the 019/020 business-image lifecycle registry only.

alter table business_image_objects
  add column if not exists reconcile_lease_token uuid,
  add column if not exists reconcile_lease_expires_at timestamptz,
  add column if not exists reconcile_attempt_count integer not null default 0,
  add column if not exists reconcile_next_attempt_at timestamptz,
  add column if not exists reconcile_last_error_code text,
  add column if not exists reconcile_last_attempt_at timestamptz;

alter table business_image_objects
  drop constraint if exists chk_business_image_reconcile_attempt_count;

alter table business_image_objects
  add constraint chk_business_image_reconcile_attempt_count
  check (reconcile_attempt_count >= 0);

alter table business_image_objects
  drop constraint if exists chk_business_image_reconcile_lease_pair;

alter table business_image_objects
  add constraint chk_business_image_reconcile_lease_pair
  check (
    (reconcile_lease_token is null and reconcile_lease_expires_at is null)
    or
    (reconcile_lease_token is not null and reconcile_lease_expires_at is not null)
  );

alter table business_image_objects
  drop constraint if exists chk_business_image_reconcile_error_code;

alter table business_image_objects
  add constraint chk_business_image_reconcile_error_code
  check (reconcile_last_error_code is null or char_length(reconcile_last_error_code) <= 80);

create index if not exists idx_business_image_reconcile_due
  on business_image_objects (reconcile_next_attempt_at, updated_at, object_key)
  where state in ('upload_pending', 'delete_pending');

comment on column business_image_objects.reconcile_lease_token is
  'Server-owned finite lease token for background reconciliation of pending business-image lifecycle rows.';
comment on column business_image_objects.reconcile_lease_expires_at is
  'Lease expiry; expired leases may be reclaimed by a later scheduled reconciliation run.';
comment on column business_image_objects.reconcile_attempt_count is
  'Count of background reconciliation claims. Used only for bounded retry/backoff.';
comment on column business_image_objects.reconcile_next_attempt_at is
  'Earliest time a pending lifecycle row is eligible for another background reconciliation claim.';
comment on column business_image_objects.reconcile_last_error_code is
  'Bounded non-PII operational error code from the last deferred reconciliation attempt.';
comment on column business_image_objects.reconcile_last_attempt_at is
  'Timestamp of the most recent background reconciliation claim.';
