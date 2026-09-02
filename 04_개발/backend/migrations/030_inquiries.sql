-- DanjiOn resident inquiry lifecycle v1.
-- Photo attachments remain outside this migration until the owner-approved private-file size policy is fixed.

create table if not exists inquiries (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete restrict,
  inquiry_type text not null,
  title text not null,
  body text not null,
  status text not null default 'received' check (status in ('received','in_progress','answered','closed')),
  response_text text,
  answered_by uuid references app_users(id) on delete set null,
  answered_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, complex_id),
  check (char_length(inquiry_type) between 1 and 64),
  check (char_length(title) between 1 and 160),
  check (char_length(body) between 1 and 10000),
  check (response_text is null or char_length(response_text) between 1 and 10000),
  check (status not in ('answered','closed') or (response_text is not null and answered_at is not null)),
  check (status <> 'closed' or closed_at is not null)
);

create index if not exists idx_inquiries_user_created
  on inquiries (user_id, complex_id, created_at desc, id desc);

create index if not exists idx_inquiries_operator_queue
  on inquiries (complex_id, status, created_at asc, id asc);

drop trigger if exists trg_inquiries_updated_at on inquiries;
create trigger trg_inquiries_updated_at
  before update on inquiries
  for each row execute function set_updated_at();
