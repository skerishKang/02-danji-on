-- Resident benefit wallet / redemption state.
-- A resident may claim each benefit once. Claim codes are server-issued and never accepted from the client.

create table if not exists benefit_claims (
  id uuid primary key default gen_random_uuid(),
  benefit_id uuid not null references benefits(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  complex_id uuid not null references complexes(id) on delete cascade,
  claim_code text not null unique,
  status text not null default 'stored' check (status in ('stored','used')),
  claimed_at timestamptz not null default now(),
  used_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, benefit_id)
);

create index if not exists idx_benefit_claims_user_status
  on benefit_claims (user_id, status, claimed_at desc);

create index if not exists idx_benefit_claims_complex
  on benefit_claims (complex_id, claimed_at desc);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_benefit_claim_code_format') then
    alter table benefit_claims
      add constraint chk_benefit_claim_code_format
      check (claim_code ~ '^DANJION-[A-Z0-9]{8}$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'chk_benefit_claim_used_at') then
    alter table benefit_claims
      add constraint chk_benefit_claim_used_at
      check ((status = 'stored' and used_at is null) or (status = 'used' and used_at is not null));
  end if;
end $$;

drop trigger if exists trg_benefit_claims_updated_at on benefit_claims;
create trigger trg_benefit_claims_updated_at before update on benefit_claims
for each row execute function set_updated_at();
