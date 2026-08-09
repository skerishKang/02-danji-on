-- DanjiOn V2 loginless preview demo seed.
-- NON-PRODUCTION ONLY.
-- Approved target: Neon child `cloudflare-preview-20260808` / `br-hidden-frog-azdevrqe`.
-- Contains only synthetic QA identities and content. Never run against production.

begin;

insert into complexes (id, slug, name, address, status)
values (
  '11111111-1111-4111-8111-111111111111',
  'bangnim-myeongji-roadhill',
  '방림명지로드힐',
  '광주광역시 남구 방림동',
  'pilot'
)
on conflict (slug) do update
set name = excluded.name,
    address = excluded.address,
    status = excluded.status;

insert into app_users (id, auth_user_id, display_name)
values
  ('22222222-2222-4222-8222-222222222221', 'dev-resident-001', '김하늘'),
  ('22222222-2222-4222-8222-222222222222', 'dev-unverified-001', '이웃 주민'),
  ('22222222-2222-4222-8222-222222222223', 'dev-manager-001', '단지온 운영자')
on conflict (auth_user_id) do update
set display_name = excluded.display_name,
    updated_at = now();

insert into complex_memberships (
  id, complex_id, user_id, role, verification_status, verified_at, building, unit
)
values
  (
    '33333333-3333-4333-8333-333333333331',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222221',
    'resident', 'verified', now(), 'QA', '101'
  ),
  (
    '33333333-3333-4333-8333-333333333332',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'resident', 'pending', null, 'QA', '102'
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222223',
    'manager', 'verified', now(), 'QA', '900'
  )
on conflict (complex_id, user_id) do update
set role = excluded.role,
    verification_status = excluded.verification_status,
    verified_at = excluded.verified_at,
    building = excluded.building,
    unit = excluded.unit,
    updated_at = now();

insert into resident_verifications (
  id, membership_id, building_code, unit_code, method, status, reviewed_by, reviewed_at, note
)
values
  (
    '99999999-9999-4999-8999-999999999991',
    '33333333-3333-4333-8333-333333333331',
    'QA', '101', 'manual', 'verified',
    '22222222-2222-4222-8222-222222222223', now(),
    'Synthetic V2 preview resident verification'
  ),
  (
    '99999999-9999-4999-8999-999999999992',
    '33333333-3333-4333-8333-333333333332',
    'QA', '102', 'manual', 'pending',
    null, null,
    'Synthetic V2 preview pending verification'
  )
on conflict (membership_id) do update
set building_code = excluded.building_code,
    unit_code = excluded.unit_code,
    method = excluded.method,
    status = excluded.status,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at,
    note = excluded.note;

insert into business_categories (id, slug, name, sort_order, is_active)
values
  ('44444444-4444-4444-8444-444444444441', 'food', '반찬·식품', 10, true),
  ('44444444-4444-4444-8444-444444444442', 'learning', '과외·수업', 20, true),
  ('44444444-4444-4444-8444-444444444443', 'home-care', '생활수리·청소', 30, true),
  ('44444444-4444-4444-8444-444444444444', 'professional', '전문서비스', 40, true)
on conflict (slug) do update
set name = excluded.name,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active;

insert into businesses (
  id, owner_user_id, category_id, kind, name, summary, description,
  price_text, service_area, availability_text, status
)
values (
  '55555555-5555-4555-8555-555555555551',
  '22222222-2222-4222-8222-222222222221',
  '44444444-4444-4444-8444-444444444441',
  'shop',
  '오늘의 반찬',
  '매일 아침 직접 만든 반찬과 국을 준비합니다.',
  '제철 재료로 집밥처럼 편하게 먹을 수 있는 반찬을 만들고, 필요한 메뉴는 미리 주문받아 준비합니다.',
  '반찬 4,000원부터 · 국 7,000원부터',
  '방림명지로드힐 · 방림동 인근',
  '평일 오전 9시–오후 7시 · 토요일 오전',
  'approved'
)
on conflict (id) do update
set owner_user_id = excluded.owner_user_id,
    category_id = excluded.category_id,
    kind = excluded.kind,
    name = excluded.name,
    summary = excluded.summary,
    description = excluded.description,
    price_text = excluded.price_text,
    service_area = excluded.service_area,
    availability_text = excluded.availability_text,
    status = excluded.status,
    updated_at = now();

insert into business_complex_relations (
  id, business_id, complex_id, relation_type, verification_status,
  priority, verified_by, verified_at
)
values (
  '66666666-6666-4666-8666-666666666661',
  '55555555-5555-4555-8555-555555555551',
  '11111111-1111-4111-8111-111111111111',
  'resident', 'verified', 10,
  '22222222-2222-4222-8222-222222222223', now()
)
on conflict (business_id, complex_id) do update
set relation_type = excluded.relation_type,
    verification_status = excluded.verification_status,
    priority = excluded.priority,
    verified_by = excluded.verified_by,
    verified_at = excluded.verified_at;

insert into business_contacts (
  id, business_id, contact_type, contact_value, visibility, sort_order
)
values (
  '77777777-7777-4777-8777-777777777771',
  '55555555-5555-4555-8555-555555555551',
  'phone', '010-0000-0000', 'verified_residents', 0
)
on conflict do nothing;

insert into benefits (
  id, complex_id, business_id, title, description, conditions, status
)
values (
  '88888888-8888-4888-8888-888888888881',
  '11111111-1111-4111-8111-111111111111',
  '55555555-5555-4555-8555-555555555551',
  '입주민 10% 할인',
  '방림명지로드힐 입주민이 오늘의 반찬을 주문하면 결제 금액의 10%를 할인받을 수 있습니다.',
  '주문 시 단지온 주민혜택 번호를 보여주세요.',
  'active'
)
on conflict (id) do update
set title = excluded.title,
    description = excluded.description,
    conditions = excluded.conditions,
    status = excluded.status,
    updated_at = now();

commit;
