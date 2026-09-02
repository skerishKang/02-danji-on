-- DanjiOn stable public business share slugs.
-- Share identifiers are complex-scoped, server-generated and immutable.

alter table business_complex_relations
  add column if not exists share_slug text;

update business_complex_relations
set share_slug = 'shop-' || encode(gen_random_bytes(12), 'hex')
where share_slug is null;

alter table business_complex_relations
  alter column share_slug set default ('shop-' || encode(gen_random_bytes(12), 'hex'));

alter table business_complex_relations
  alter column share_slug set not null;

alter table business_complex_relations
  drop constraint if exists chk_business_complex_relation_share_slug;

alter table business_complex_relations
  add constraint chk_business_complex_relation_share_slug
  check (share_slug ~ '^[a-z0-9][a-z0-9-]{7,63}$');

create unique index if not exists uq_business_complex_share_slug
  on business_complex_relations (complex_id, share_slug);

create or replace function prevent_business_share_slug_change()
returns trigger
language plpgsql
as $$
begin
  if old.share_slug is distinct from new.share_slug then
    raise exception 'business share slug is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_business_share_slug_immutable on business_complex_relations;
create trigger trg_business_share_slug_immutable
  before update of share_slug on business_complex_relations
  for each row execute function prevent_business_share_slug_change();
