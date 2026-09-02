-- DanjiOn resident conversation/message core v1.
-- Resident messaging is complex-scoped, server-authorized, and PII-minimal.

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  type text not null default 'resident' check (type in ('resident','shop')),
  business_id uuid references businesses(id) on delete cascade,
  resident_pair_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (type = 'resident' and business_id is null and resident_pair_key is not null)
    or
    (type = 'shop' and business_id is not null and resident_pair_key is null)
  ),
  check (resident_pair_key is null or char_length(resident_pair_key) = 73)
);

create unique index if not exists uq_conversations_resident_pair
  on conversations (complex_id, resident_pair_key)
  where type = 'resident';

create table if not exists conversation_members (
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_user_id uuid not null,
  body text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (conversation_id, sender_user_id)
    references conversation_members(conversation_id, user_id) on delete restrict,
  check (char_length(body) between 1 and 2000)
);

create table if not exists blocks (
  blocker_user_id uuid not null references app_users(id) on delete cascade,
  blocked_user_id uuid not null references app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id),
  check (blocker_user_id <> blocked_user_id)
);

create index if not exists idx_conversation_members_user
  on conversation_members (user_id, joined_at desc);

create index if not exists idx_messages_conversation_created
  on messages (conversation_id, created_at asc, id asc);

create index if not exists idx_blocks_blocked_user
  on blocks (blocked_user_id, blocker_user_id);

drop trigger if exists trg_conversations_updated_at on conversations;
create trigger trg_conversations_updated_at
  before update on conversations
  for each row execute function set_updated_at();
