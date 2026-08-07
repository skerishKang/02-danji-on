# 단지온 입주민 인증 v1

## 1. 인증과 로그인 분리

단지온에서 로그인과 입주민 인증은 서로 다른 문제다.

```text
Auth
= 이 사용자가 누구인가

Resident Verification
= 이 사용자가 이 단지의 실제 입주민/구성원인가
```

Neon Auth를 연결하더라도 `complex_memberships.verification_status`가 단지 도메인의 인증 기준이다.

## 2. 상태

```text
unverified
  ↓ 신청
pending
  ├─ 승인 → verified
  └─ 반려 → rejected
                 ↓ 재신청
               pending
```

`verified`가 된 회원은 일반 신청 UI에서 다시 인증 신청할 수 없다.

## 3. 주민 입력

필수:

- 동
- 호수
- 인증 방법

방법:

- `management_confirmation`: 관리사무소/운영자 확인
- `document`: 고지서·서류 이미지
- `manual`: 운영자 수동 확인

`document` 방식은 evidence object key가 필수다.

## 4. 개인정보 정책

동·호수와 인증 증빙은 공개 프로필이 아니다.

공개 business API, 다른 주민 화면, 검색 결과에 포함하지 않는다.

```text
공개 가능
- display name
- 가게/서비스 정보

비공개
- 정확한 동/호수
- 인증 증빙
- 검토 메모
```

실서비스에서는 주민 인증 증빙을 공개 R2 bucket에 저장하지 않는다. 별도 private object policy와 보관기간이 필요하다.

## 5. Backend API

주민:

```text
GET  /api/v1/me/complexes/:complexSlug/resident-verification
POST /api/v1/me/complexes/:complexSlug/resident-verification
```

관리자:

```text
GET   /api/v1/admin/complexes/:complexSlug/resident-verifications
PATCH /api/v1/admin/resident-verifications/:verificationId
```

관리자 API는 해당 단지의 verified `manager|admin` membership이 필요하다.

## 6. DB

기존:

```text
complex_memberships
- building
- unit
- verification_status

resident_verifications
- membership_id UNIQUE
- method
- evidence_object_key
- requested_at
- reviewed_at
- reviewed_by
- note
```

추가 migration:

`006_resident_verification_constraints.sql`

- building/unit 20자 상한
- method enum-like CHECK
- evidence key 500자 상한
- note 1000자 상한

## 7. Pre-Infra UI

주민:

`/verification.html`

- 현재 인증 상태
- 신청/재신청
- 동·호수 입력
- 인증 방식 선택
- document 증빙 mock upload

관리자:

`/verification-admin.html`

- 상태 필터
- 신청자/동·호수/방식
- 증빙 연결 여부
- 검토 메모
- 승인/반려

이 두 화면은 먼저 독립 surface로 검증하고, 안정화 후 주민 `내정보`와 운영관리 `/admin.html`에 흡수한다.

## 8. Mock 검증

localStorage:

`danjion.mock.resident-verifications.v1`

E2E:

```text
미인증
→ 주민 신청
→ pending
→ 관리자 확인
→ verified
```

반려:

```text
pending
→ rejected + note
→ 주민 수정/재신청
→ pending
```

Mock storage는 production 개인정보 저장소가 아니다.

## 9. 연락처 권한

실 Backend contact endpoint의 기준은 현재도 다음과 같다.

- 해당 단지 membership 존재
- `verification_status = verified`
- 또는 manager/admin 특권

따라서 Neon Auth 연결 여부와 관계없이 입주민 인증이 완료되지 않으면 비공개 연락처를 공개하지 않는다.
