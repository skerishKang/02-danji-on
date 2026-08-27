-- DanjiOn business-image resolved-state reconciliation cleanup.
-- Extends migrations 019/020/021/022 for the business-image registry only.
--
-- Reconciliation lease ownership and retry scheduling belong only to unresolved
-- upload_pending/delete_pending work. Historical attempt counters/timestamps are
-- retained after resolution for operational observability.

update business_image_objects
set reconcile_lease_token = null,
    reconcile_lease_expires_at = null,
    reconcile_next_attempt_at = null,
    reconcile_last_error_code = null,
    updated_at = now()
where state in ('active', 'retired')
  and (
    reconcile_lease_token is not null
    or reconcile_lease_expires_at is not null
    or reconcile_next_attempt_at is not null
    or reconcile_last_error_code is not null
  );

alter table business_image_objects
  drop constraint if exists chk_business_image_resolved_reconciliation_clear;

alter table business_image_objects
  add constraint chk_business_image_resolved_reconciliation_clear
  check (
    state in ('upload_pending', 'delete_pending')
    or (
      reconcile_lease_token is null
      and reconcile_lease_expires_at is null
      and reconcile_next_attempt_at is null
      and reconcile_last_error_code is null
    )
  );

comment on constraint chk_business_image_resolved_reconciliation_clear
  on business_image_objects is
  'Resolved active/retired business-image rows cannot retain pending-only reconciliation ownership or retry scheduling metadata.';
