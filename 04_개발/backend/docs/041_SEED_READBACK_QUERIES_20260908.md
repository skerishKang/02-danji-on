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

-- category collision preflight (production apply 전 필수 실행)
-- 이 migration이 시드하려는 6개 slug와 6개 name이 기존에 존재하는지 확인
select id, slug, name
from business_categories
where slug in ('food','cafe','home','learn','pro','car')
   or name in (
     '음식점·카페·반찬',
     '카페·디저트',
     '생활·홈케어',
     '교육·과외',
     '전문·문서·촬영',
     '자동차 정비'
   )
order by slug, name;
```

### Category collision 판정 (preflight 결과에 따라)

| 결과 | 판정 | 조치 |
|---|---|---|
| 0 rows | `SAFE` | 그대로 apply |
| same slug + 의도한 name 그대로 | `SAFE / REUSE` | 그대로 apply — ON CONFLICT(slug)가 기존 row 재사용 |
| same slug + 다른 name | `STOP` | apply 금지 — slug 소유자가 달라 의도와 어긋남. 사전 조율 필요 |
| same name + 다른 slug | `STOP` | apply 금지 — name unique 제약 충돌로 insert가 실패함. 사전 조율 필요 |

production apply 전에 이 쿼리를 **반드시** 실행하고 판정이 SAFE/SAFE·REUSE인
경우에만 진행한다. STOP 판정 시 migration을 고쳐서 다시 PR 리뷰부터
진행한다.

## 2. Post-apply readback (적용 직후)

```sql
-- complex 1건, slug/status 확인
select id, name, slug, status
from complexes
where slug = 'banglim-myeongji-roadhill';
-- 기대: 1 row, status='pilot'

-- 이 migration이 만든 row만 (deterministic UUID exact list로 격리)
select count(*) from businesses where id in (
  'd0a1c4a1-41c5-4c51-b2b2-000000000001'::uuid,
  'd0a1c4a1-41c5-4c51-b2b2-000000000002'::uuid,
  'd0a1c4a1-41c5-4c51-b2b2-000000000003'::uuid,
  'd0a1c4a1-41c5-4c51-b2b2-000000000004'::uuid,
  'd0a1c4a1-41c5-4c51-b2b2-000000000005'::uuid,
  'd0a1c4a1-41c5-4c51-b2b2-000000000006'::uuid,
  'd0a1c4a1-41c5-4c51-b2b2-000000000007'::uuid,
  'd0a1c4a1-41c5-4c51-b2b2-000000000008'::uuid
);
-- 기대: 8

select count(*) from business_categories where id in (
  'd0a1c4a1-41c5-4c51-c3c3-000000000001'::uuid,
  'd0a1c4a1-41c5-4c51-c3c3-000000000002'::uuid,
  'd0a1c4a1-41c5-4c51-c3c3-000000000003'::uuid,
  'd0a1c4a1-41c5-4c51-c3c3-000000000004'::uuid,
  'd0a1c4a1-41c5-4c51-c3c3-000000000005'::uuid,
  'd0a1c4a1-41c5-4c51-c3c3-000000000006'::uuid
);
-- 기대: 최대 6 (기존 동일 slug category가 있으면 ON CONFLICT로 재사용 → 6 미만 가능)

select count(*) from business_complex_relations
where business_id in (
  'd0a1c4a1-41c5-4c51-b2b2-000000000001'::uuid,
  'd0a1c4a1-41c5-4c51-b2b2-000000000002'::uuid,
  'd0a1c4a1-41c5-4c51-b2b2-000000000003'::uuid,
  'd0a1c4a1-41c5-4c51-b2b2-000000000004'::uuid,
  'd0a1c4a1-41c5-4c51-b2b2-000000000005'::uuid,
  'd0a1c4a1-41c5-4c51-b2b2-000000000006'::uuid,
  'd0a1c4a1-41c5-4c51-b2b2-000000000007'::uuid,
  'd0a1c4a1-41c5-4c51-b2b2-000000000008'::uuid
);
-- 기대: 8

select count(*) from benefits where id in (
  'd0a1c4a1-41c5-4c51-a1b1-000000000001'::uuid,
  'd0a1c4a1-41c5-4c51-a1b1-000000000002'::uuid,
  'd0a1c4a1-41c5-4c51-a1b1-000000000003'::uuid,
  'd0a1c4a1-41c5-4c51-a1b1-000000000004'::uuid,
  'd0a1c4a1-41c5-4c51-a1b1-000000000005'::uuid,
  'd0a1c4a1-41c5-4c51-a1b1-000000000006'::uuid,
  'd0a1c4a1-41c5-4c51-a1b1-000000000007'::uuid,
  'd0a1c4a1-41c5-4c51-a1b1-000000000008'::uuid
);
-- 기대: 8 (가게 8개 각각 1개씩 — sibling v3 전체 benefit 원문)

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
businesses → categories(조건부) → complexes). 모든 식별은 **exact UUID IN
list**로만 수행한다(uuid 컬럼에 패턴 매칭 금지 — PostgreSQL에 uuid 패턴
연산자가 없음). complex 삭제는 `id = ...::uuid and slug =
'banglim-myeongji-roadhill'` 동시 조건을 건다. category 삭제는 이
migration이 만든 category면서 파일럿 외 business가 참조하지 않는 경우에만
(NOT EXISTS 가드). 각 단계 전에 FK 참조를 재확인하고, 파일럿 row 외 다른
row가 참조하고 있으면 즉시 중단하고 전용 backout migration을 별도 작성한다.

## 6. Product authority — sibling final v3 parity

```text
PRODUCT_AUTHORITY =
  sibling final v3 frontend at
  a2e856de522f77793ced0718cf58ab4b2d210732
  frontend/01_이웃가게_발견_v3.html (SHOP_DATA 8)

RULE =
  backend/database adapt to frontend authority.
  Do not rewrite product semantics to fit current schema.
```

### Parity matrix (seed ↔ sibling v3 SHOP_DATA)

| BUSINESS | AUTHORITY_NAME | AUTHORITY_RELATION | AUTHORITY_CATEGORY | DB_REPRESENTATION | AUTHORITY_BENEFIT | VALUE | CODE | PARITY_STATUS | GAP |
|---|---|---|---|---|---|---|---|---|---|
| 로드힐 꽃작업실 | 로드힐 꽃작업실 | 우리 주민 가게 → resident | cafe + food | food (primary only) | 꽃다발 예약 상담 시 주민 전용 혜택 | 예약혜택 | DANJION · F052 | PARTIAL | MULTI_CATEGORY, BENEFIT_VALUE, BENEFIT_CODE |
| 오늘의 반찬 | 오늘의 반찬 | 우리 주민 가게 → resident | food | food | 방림명지로드힐 주민 10% 할인 | 10% | DANJION · F010 | PARTIAL | BENEFIT_VALUE, BENEFIT_CODE |
| 온케어 홈서비스 | 온케어 홈서비스 | 주민 가족 가게 → resident_family | home | home | 방림명지로드힐 출장비 면제 | 면제 | DANJION · H001 | PARTIAL | BENEFIT_VALUE, BENEFIT_CODE |
| 바른 세무상담 | 바른 세무상담 | 우리 주민 가게 → resident | pro | pro | 방림명지로드힐 첫 상담 무료 | 무료 | DANJION · P001 | PARTIAL | BENEFIT_VALUE, BENEFIT_CODE |
| 한결수학 | 한결수학 | 우리 주민 가게 → resident | learn | learn | 방림명지로드힐 학생 첫 수업 무료 | 무료 | DANJION · L001 | PARTIAL | BENEFIT_VALUE, BENEFIT_CODE |
| 우리동네 자동차정비 | 우리동네 자동차정비 | 이웃단지 가게 → neighbor | car + home | car (primary only) | 주민 공임 할인 | 공임할인 | DANJION · C014 | PARTIAL | MULTI_CATEGORY, BENEFIT_VALUE, BENEFIT_CODE |
| 정다운 헤어 | 정다운 헤어 | 주민 가족 가게 → resident_family | home | home | 입주민 커트 할인 | 할인 | DANJION · B018 | PARTIAL | BENEFIT_VALUE, BENEFIT_CODE |
| 사진하는 이웃 | 사진하는 이웃 | 우리 주민 가게 → resident | pro | pro | 입주민 촬영비 할인 | 촬영할인 | DANJION · PH01 | PARTIAL | BENEFIT_VALUE, BENEFIT_CODE |

- 이름/copy/relation/benefit 문구는 v3 원문 그대로 seed (PASS). PARITY가
  PARTIAL인 이유는 아래 SCHEMA_GAP뿐이다.

### SCHEMA_GAP (이번 PR에서 schema redesign 없이 문서로만 남김)

```text
SCHEMA_GAP_MULTI_CATEGORY = YES
  AUTHORITY_VALUE = 로드힐 꽃작업실 "cafe food", 우리동네 자동차정비 "car home"
  CURRENT_DB_REPRESENTATION = primary category only (businesses.category_id 단일)
  FOLLOWUP_REQUIRED = business-category many-to-many contract

SCHEMA_GAP_BENEFIT_VALUE = YES
  AUTHORITY_VALUE = 가게별 value 문자열 (예: 오늘의 반찬 value = 10%)
  CURRENT_DB_REPRESENTATION = 별도 컬럼 없음 (v3 문구 자체는 benefits.title에 보존)
  FOLLOWUP_REQUIRED = benefit value storage + API contract extension

SCHEMA_GAP_BENEFIT_CODE = YES
  AUTHORITY_VALUE = 가게별 code (예: 오늘의 반찬 code = DANJION · F010)
  CURRENT_DB_REPRESENTATION = 별도 컬럼 없음 (code는 benefits.description에
    "단지온 …(DANJION · Fxxx)" 형태로 문자열 보존 — data는 소실되지 않으나
    구조화된 필드는 아님)
  FOLLOWUP_REQUIRED = benefit code storage + API contract extension
```

중립화 문구("주민 할인 안내", "출장비 관련 안내", "첫 상담 관련 안내",
"파일럿 예시 혜택입니다…" 등)는 모두 제거하고 v3 원문 benefit으로
교체했다. #253/#139는 delivery-mode 결정 보류일 뿐, v3에 이미 있는
혜택 문구를 중립화하는 근거가 아니다.
