-- DanjiOn Issue #861: record member account deletion requests.
--
-- The product "회원 탈퇴" action must not silently delete account/user data and
-- must not keep pretending to be a demo. This migration only adds an append-only
-- request log so a deletion request can be received, queued as 'pending', and
-- processed later by an operator-owned workflow.
--
-- Scope
--   account_deletion_requests only.
--   No account/app_users row is deleted, modified, or anonymized here.
--   Existing data is left untouched.
--
-- Idempotent / deterministic
--   create table if not exists / create index if not exists.
--   A partial unique index keeps at most one 'pending' request per user, so the
--   API can reject duplicates without a race.
--
-- Authority
--   user_id is resolved by the API from the authenticated actor (requireActor),
--   never from the request body. No foreign key is declared on purpose so this
--   request log can never block or cascade an existing app_users deletion path.
--
-- Rollback (manual, destructive)
--   drop table if exists account_deletion_requests;

create table if not exists account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  reason text,
  constraint chk_account_deletion_requests_status
    check (status in ('pending', 'processed', 'cancelled'))
);

create unique index if not exists uq_account_deletion_requests_pending
  on account_deletion_requests (user_id)
  where status = 'pending';

create index if not exists idx_account_deletion_requests_status_requested_at
  on account_deletion_requests (status, requested_at);
