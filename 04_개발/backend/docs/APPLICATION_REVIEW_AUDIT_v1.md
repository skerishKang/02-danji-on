# Business Application Review Audit v1

## 목적

`business_applications.review_note`는 최신 상태를 보여주는 필드다. 보완 요청과 재제출이 반복되면 최신 row만으로는 과거 판단 근거를 복원할 수 없으므로 상태 변경을 immutable event로 별도 보존한다.

## DB

Migration:

`004_application_review_history.sql`

Table:

`business_application_review_events`

주요 필드:

- `application_id`
- `complex_id`
- `actor_user_id`
- `actor_type`: `applicant | manager | system`
- `from_status`
- `to_status`
- `review_note`
- `created_at`

## 기록 시점

`business_applications`의 다음 값이 변경될 때 trigger가 event를 생성한다.

- status
- review_note
- approved_business_id

관리자 검토는 `reviewed_by`가 있으므로 manager actor로 기록한다.

신청자가 보완내용을 재제출하면 `reviewed_by = null`로 되돌리고 applicant actor로 기록한다.

## Admin API

```http
GET /api/v1/admin/complexes/:complexSlug/application-review-events
```

선택 Query:

- `applicationId=<uuid>`
- `limit=1..200`

권한:

- 해당 단지 membership
- role `manager | admin`
- verification_status `verified`

단지 경계를 넘어 다른 단지 이력을 읽을 수 없다.

## Operations UI

`/admin.html` → `검토 이력`

표시 항목:

- 가게·서비스명
- 신청자/관리자/시스템 actor
- 이전 상태 → 새 상태
- 당시 검토 메모
- 변경 시각

전체 이력 또는 특정 신청만 필터할 수 있다.

## Mock / E2E

실 DB 없이도 `mock-audit-store.ts`가 같은 의미의 event를 localStorage에 보존한다.

Playwright는 다음을 검증한다.

```text
관리자 보완 요청
→ 주민 보완 재제출
→ 검토 이력에 applicant changes_requested → pending 기록

관리자 승인
→ 검토 이력에 manager pending → approved 기록
```

Mock event store는 개발 검증용이며 production audit log의 대체물이 아니다.
