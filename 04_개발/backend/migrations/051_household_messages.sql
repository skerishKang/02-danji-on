-- DanjiOn household-targeted in-app message source of truth.
-- Source-only migration for #761. Production apply and send-mode activation require separate authority.

create table if not exists household_messages (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  sender_user_id uuid not null references app_users(id) on delete restrict,
  target_type text not null check (target_type in ('unit','units','building','all')),
  target_selector jsonb not null default '{}'::jsonb,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 4000),
  status text not null default 'draft' check (status in ('draft','sent')),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 160),
  request_fingerprint text not null check (char_length(request_fingerprint) = 64),
  target_unit_count integer not null default 0 check (target_unit_count >= 0),
  intended_recipient_count integer not null default 0 check (intended_recipient_count >= 0),
  delivered_recipient_count integer not null default 0 check (delivered_recipient_count >= 0),
  failed_recipient_count integer not null default 0 check (failed_recipient_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  check (jsonb_typeof(target_selector) = 'object'),
  check (
    (status = 'draft' and sent_at is null)
    or
    (status = 'sent' and sent_at is not null)
  )
);

create unique index if not exists uq_household_messages_complex_idempotency
  on household_messages (complex_id, idempotency_key);

create index if not exists idx_household_messages_complex_created
  on household_messages (complex_id, created_at desc, id desc);

create table if not exists household_message_deliveries (
  message_id uuid not null references household_messages(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  read_at timestamptz,
  primary key (message_id, user_id)
);

create index if not exists idx_household_message_deliveries_user
  on household_message_deliveries (user_id, delivered_at desc, message_id);

create table if not exists household_message_events (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references household_messages(id) on delete cascade,
  event_type text not null check (event_type in ('created','dispatch_started','dispatch_completed')),
  actor_user_id uuid not null references app_users(id) on delete restrict,
  request_id text not null check (char_length(request_id) between 1 and 80),
  intended_recipient_count integer not null default 0 check (intended_recipient_count >= 0),
  delivered_recipient_count integer not null default 0 check (delivered_recipient_count >= 0),
  failed_recipient_count integer not null default 0 check (failed_recipient_count >= 0),
  created_at timestamptz not null default now(),
  unique (message_id, event_type)
);

create or replace function reject_household_message_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'household_message_events are immutable';
end;
$$;

drop trigger if exists trg_household_message_events_immutable on household_message_events;
create trigger trg_household_message_events_immutable
  before update or delete on household_message_events
  for each row execute function reject_household_message_event_mutation();

drop trigger if exists trg_household_messages_updated_at on household_messages;
create trigger trg_household_messages_updated_at
  before update on household_messages
  for each row execute function set_updated_at();
