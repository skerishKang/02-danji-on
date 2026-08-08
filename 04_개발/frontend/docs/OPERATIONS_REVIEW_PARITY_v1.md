# Scene 07 운영확인 → 승인 공개 계약 v1

## 기준

Drive `단지온_8월현장시연_통합시제품_v1`의 고정 순환:

`4단계 등록 → 홍보물 3종 → 운영확인 → 승인 공개 → 주민 목록 재진입`

Scene 07의 핵심은 관리자가 모든 개인정보를 보는 화면이 아니라, **주민에게 공개할 프로필과 운영자만 확인할 주민 관계 요약을 명시적으로 분리**하는 것이다.

## 공개 정보

주민 공개 대상:

- 가게·서비스명
- 분야
- 한 줄 소개
- 가격/이용방법
- 이용 지역
- 이용 시간
- 주민혜택
- 대표 이미지 object key에서 해석되는 공개용 이미지

## 비공개 확인 정보

운영확인 화면에서만 표시:

- 신청자 표시명
- 주민 관계 유형
- 입주민 인증 상태
- 관계 확인자료의 **개수**

화면 문구는 `확인자료 1건`처럼 존재 여부만 보여준다.

## 절대 반환/노출하지 않는 정보

Scene 07 review-context API는 다음 필드를 SELECT/응답하지 않는다.

- 정확한 동 정보
- 정확한 호수 정보
- 증빙 이미지 object key
- 증빙 문서 원문

실제 증빙 원문 검토가 별도 운영 기능으로 필요해지더라도 이 endpoint를 확장하지 않고 별도 권한·감사 경계를 만든다.

## Backend

`GET /api/v1/admin/business-applications/:applicationId/review-context`

- 인증된 manager/admin만 접근
- 공개 프로필과 privateVerification을 별도 object로 응답
- privateVerification은 집계 상태만 응답

승인은 기존 계약을 재사용한다.

`PATCH /api/v1/admin/business-applications/:applicationId`

`status=approved`이면 기존 atomic CTE가:

1. 신청을 approved로 변경
2. business 생성
3. complex relation 생성/verified
4. 대표 이미지 연결
5. 주민혜택 생성

을 하나의 DB statement로 처리한다.

## Frontend

- `/admin.html`: 신청 카드에 `운영확인`
- `/operations-review.html?application=<id>`: Scene 07 전용 화면
- 공개/비공개 두 영역 분리
- `승인하여 공개`
- 승인 완료 시 실제 공개 service count의 `이전 → 이후` 표시
- `주민 공개목록에서 확인`으로 `/` 주민 앱 재진입
- 주민 앱 deep-link가 가게·서비스 전체 목록을 열고 승인된 가게를 강조

## 시제품 7→8과 실제 제품 데이터

Drive 시제품은 공개 서비스 7개를 고정 fixture로 사용해 승인 후 8개가 된다.
현재 React 개발본은 v5 기반 mock 사업체가 더 많으므로 숫자 `7 → 8`을 하드코딩하지 않는다.

제품 코드에서는 승인 전 실제 공개 수를 읽고 승인 후 다시 읽어 **정확히 +1 증가하는지** 검증한다. 이는 시제품의 의미를 보존하면서 실제 데이터와 불일치하는 데모 숫자를 제품 로직에 주입하지 않기 위한 결정이다.

## E2E Gate

1. 한결수학 4단계 등록
2. 홍보물 3종 완성
3. 관리자 `운영확인`
4. 공개/비공개 영역 확인
5. `확인자료 1건` 확인
6. 동·호수/증빙 원문 미노출 확인
7. 승인하여 공개
8. 공개 서비스 수 +1 확인
9. 주민 가게·서비스 목록 재진입
10. 한결수학 카드 강조/노출 확인
11. 승인된 신청의 재승인 버튼 없음
12. 승인 전/후 axe serious·critical 0

## 인프라 상태

Neon / Cloudflare / R2 실계정 연결은 하지 않는다. mock과 API contract만 같은 상태전이를 갖도록 유지한다.
