# 041 Seed Readback Queries — Banglim pilot (Stage 5-C)

상태: **migration 작성만 완료, DB 미적용** (`DB_APPLIED = NO`)

이 문서는 `04_개발/backend/migrations/041_seed_banglim_pilot_production.sql`의
적용 전/후 확인용 read-only 쿼리와 예상 결과를 정의한다.
Stage 5-C에서는 어떤 쿼리도 production에 실행하지 않는다(적용 단계에서 사용).

## 1. Pre-apply readback (적용 직전, 전부 SELECT만)

```sql
-- complex 존재 여부
select id, name, slug, status
from complexes
where slug = 'banglim-myeongji-roadhill';
-- 기대: 0 rows

-- business 총량
select count(*) from businesses;
-- 기대(2026-09-08 감아드 기준): 0

-- pilot discovery join count (실제 public API WHERE와 동일 계약)
select count(*) as discoverable
from businesses b
join business_complex_relations r on r.business_id = b.id
join complexes c on c.id = r.complex_id
where c.slug = 'banglim-myeongji-roadhill'
  and c.status in ('active','pilot')
  and b.status = 'approved'
  and r.verification_status = 'verified';
-- 기대: 0
```

## 2. Post-apply readback (적용 직후)

```sql
-- complex 1건, slug/status 확인
select id, name, slug, status
from complexes
where slug = 'banglim-myeongji-roadhill';
-- 기대: 1 row, status='pilot'

-- 이 migration이 만든 row만 (deterministic UUID prefix로 격리)
select count(*) from businesses where id like 'd0a1c4a1-41c5-4c51-b2b2-%';
-- 기대: 8

select count(*) from business_categories where id like 'd0a1c4a1-41c5-4c51-c3c3-%';
-- 기대: 최대 6 (기존 동일 slug category가 있으면 ON CONFLICT로 재사용 → 6 미만 가능)

select count(*) from business_complex_relations
where business_id like 'd0a1c4a1-41c5-4c51-b2b2-%';
-- 기대: 8

select count(*) from benefits where id like 'd0a1c4a1-41c5-4c51-a1b1-%';
-- 기대: 4

-- public discovery join count (API 노출 기준, 위 pre-apply와 동일 쿼리)
-- 기대: 8
```

## 3. API 기대값 (적용 후에만 확인; Stage 5-C 범위 밖)

```
GET /api/v1/complexes/banglim-myeongji-roadhill
  => 200, data.slug = 'banglim-myeongji-roadhill', data.status = 'pilot'

GET /api/v1/complexes/banglim-myeongji-roadhill/businesses?limit=50
  => 200, data.length = 8
     relation 정렬: resident → resident_family → neighbor 순, priority 100 동순위
```

## 4. Idempotency 확인 (재적용 시)

같은 migration을 다시 실행해도 모든 insert가 `ON CONFLICT DO NOTHING`이므로
row 수 변화 없음. 재적용 후 위 post-apply readback 수치가 동일하게 유지되어야 한다.

## 5. Rollback (수동 절차 — 자동화 금지)

migration 파일 헤더 주석의 5단계 순서를 따른다 (benefits → relations →
businesses → categories(조건부) → complexes). 각 단계 전에 FK 참조를 재확인하고,
파일럿 row 외 다른 row가 참조하고 있으면 즉시 중단하고 전용 backout
migration을 별도 작성한다.
