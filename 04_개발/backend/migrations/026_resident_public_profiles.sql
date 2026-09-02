-- DanjiOn safe resident public profile extension v1.
-- Core nickname/avatar/join date remain canonical on app_users; only public presentation extension lives here.

create table if not exists resident_public_profiles (
  user_id uuid primary key references app_users(id) on delete cascade,
  public_bio text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(public_bio) <= 300)
);

drop trigger if exists trg_resident_public_profiles_updated_at on resident_public_profiles;
create trigger trg_resident_public_profiles_updated_at
  before update on resident_public_profiles
  for each row execute function set_updated_at();
