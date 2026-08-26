-- DanjiOn product-account lifecycle.
-- Authentication credentials remain owned by the configured auth provider.
-- This migration only controls DanjiOn product authorization/presentation.

alter table app_users
  add column if not exists account_status text not null default 'active';

alter table app_users
  add column if not exists closed_at timestamptz;

alter table app_users
  drop constraint if exists chk_app_users_account_status;

alter table app_users
  add constraint chk_app_users_account_status
  check (account_status in ('active','closed'));

alter table app_users
  drop constraint if exists chk_app_users_closed_at;

alter table app_users
  add constraint chk_app_users_closed_at
  check (account_status <> 'closed' or closed_at is not null);

create index if not exists idx_app_users_account_status
  on app_users (account_status, updated_at desc);

comment on column app_users.account_status is
  'DanjiOn product-account state. A valid external auth token never overrides closed product-account state.';
