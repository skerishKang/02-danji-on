# DanjiOn MVP Auth / Identity / Resident / Business Verification Plan v1

> 상태: **PROPOSAL FOR SIBLING REVIEW — NOT YET IMPLEMENTATION AUTHORITY**
>
> 2026-08-08 개발 일시중지 전 작성한 제품정책 제안서다. 동생과 논의 후 확정한다. 이 문서의 미확정 항목을 근거로 로그인 UI나 인증 자동화를 임의 구현하지 않는다.

## 1. 핵심 원칙

DanjiOn에서 아래 네 개를 분리한다.

1. **Authentication** — 이 사용자가 누구인가
2. **Product identity** — DanjiOn 내부 사용자 레코드가 무엇인가
3. **Resident verification / apartment authorization** — 이 사람이 어느 단지에서 어떤 자격을 갖는가
4. **Business verification / management authority** — 이 사람이 어떤 business와 어떤 관계를 갖는가

따라서:

`Google 로그인 성공 = 입주민 인증 성공`

이 아니며,

`입주민 인증 성공 = 사업자 확인 성공`

도 아니다.

## 2. 현재 코드가 이미 보장하는 방향

Track A backend는 다음 구조를 사용한다.

```text
Neon Auth session/access JWT
  -> Authorization: Bearer <jwt>
  -> JWT verification
  -> JWT sub
  -> app_users.auth_user_id
  -> app_users.id
  -> complex_memberships
  -> role / resident verification authorization
```

현재 구현정책:

- 최초 유효 Auth subject는 필요하면 `app_users`만 bootstrap
- 로그인 성공만으로 complex membership 생성 안 함
- 로그인 성공만으로 verified resident 처리 안 함
- 로그인 성공만으로 manager/admin 처리 안 함
- production dev-header bypass 금지

이 원칙은 유지한다.

## 3. 현재 frontend gap

현재 integration branch의 `src/auth.ts`는:

- DevAuthProvider: 존재
- NeonAuthProvider: 실제 browser session/token adapter 미구현

따라서 다음 단계에서는 backend Auth를 다시 만드는 것이 아니라 **frontend login/session + Bearer token 연결**이 핵심이다.

## 4. MVP 로그인 수단 — 제안안

### 1차 제안

- Google login
- 이메일 기반 login — OTP 또는 magic-link 계열 중 Neon Auth 실제 지원/UX 확인 후 하나 선택

### 후속 후보

- Kakao
- Naver
- Apple
- 휴대전화 본인인증/PASS

MVP에서 Google 하나만 강제하지 않는 이유:

- 비Google 사용자의 진입장벽
- 실제 아파트 주민층의 연령/계정 사용 다양성

단, login provider는 동생 검토 후 최종 확정한다.

## 5. 사용자 상태 모델

`role` 하나로 resident/business/admin을 표현하지 않는다.

한 사용자가 동시에 여러 자격을 가질 수 있다.

예:

```text
user
  authenticated: yes
  verified resident at complex A: yes
  business operator: yes
  manager: no
```

제품표현상 상태 예:

- Guest
- Authenticated Member
- Resident Verification Pending
- Verified Resident
- Business Applicant
- Approved Business Operator
- Manager
- Admin

이 값들은 하나의 enum role이 아니라 여러 도메인 상태의 조합으로 해석한다.

## 6. 비로그인 사용자 정책

공개 탐색은 가능한 한 로그인 없이 허용한다.

예:

- 공개 business/service 목록
- 공개 상세정보
- 공개 단지소식/혜택 안내 중 공개영역

로그인이 필요한 기능 예:

- 내정보
- 찜 persistence
- 입주민 인증 신청
- 내 일 알리기/사업 신청

verified resident가 필요한 기능 예:

- 주민 전용 연락처
- 주민혜택 claim/use
- 단지 내부 전용 데이터

## 7. 로그인 UX 제안

사이트 첫 진입에서 강제 로그인하지 않는다.

보호기능을 누를 때 auth gate를 띄운다.

예:

```text
이 기능은 로그인이 필요합니다.

[Google로 계속]
[이메일로 계속]

로그인 후 필요하면 입주민 인증을 진행할 수 있습니다.
```

첫 로그인 직후에는 `인증 입주민`으로 표시하지 않는다.

예:

```text
가입 완료
계정: 로그인됨
방림명지로드힐: 입주민 미인증

[입주민 인증하기]
[인증 없이 둘러보기]
```

## 8. 입주민 인증 — 제안안

MVP에서는 두 경로를 둔다.

### 경로 A — 운영 편의형 code/QR

제안:

- 1회용 code
- 세대별 code
- 또는 기간 제한 QR

중 하나를 사용한다.

단지 전체가 공유하는 영구 공용코드는 유출 위험 때문에 권장하지 않는다.

예상 flow:

```text
login
 -> complex 선택
 -> 동/호 입력
 -> code/QR verification
 -> verified 또는 additional review
```

### 경로 B — 관리자 수동 확인

code가 없거나 자동 확인이 어려운 주민은:

```text
login
 -> 입주민 인증 신청
 -> 단지 / 동 / 호 / 최소 연락정보
 -> 필요 시 증빙 1건
 -> pending
 -> manager/admin review
 -> approve / reject / changes
```

### 개인정보 최소화

기본 제출자료로 주민등록등본 등 과도한 개인정보 문서를 요구하지 않는 방향을 권장한다.

필요한 경우에도 목적에 맞는 최소 증빙만 받고, 공개 business/profile API와 완전히 분리한다.

현재 storage 설계의 private resident-evidence 경계를 그대로 활용한다.

## 9. 주민 관리자 검토

관리자 화면에서 필요한 정보만 보여준다.

예:

```text
입주민 인증 요청
김OO
101동 / 세대 식별정보
신청시각
확인자료 존재여부

[승인]
[보완 요청]
[반려]
```

정확한 세대정보와 증빙원문 접근은 최소 권한과 audit가 적용되어야 한다.

현재 제품의 public review-context처럼 민감정보를 공개 surface에 섞지 않는다.

## 10. 사업자 관계 모델

DanjiOn의 business relation은 주민 인증과 별도다.

현재 relation 개념:

- resident
- resident_family
- neighbor
- local

사업 신청 UX에서 사용자가 관계를 선택하도록 한다.

예:

- 제가 직접 운영합니다
- 가족이 운영합니다
- 이웃/인근 관계입니다
- 지역 사업자입니다

## 11. 주민 사업자

입주민 verified 상태는 `이 사용자가 해당 단지 주민`이라는 강한 신호지만, **해당 business의 실제 운영권**을 자동으로 증명하지는 않는다.

따라서:

```text
verified resident
 + business application
 + 운영자 검토
 -> approved business
```

흐름을 권장한다.

## 12. 주민 가족 사업자

`resident_family`는 자동승인하지 않는다.

MVP에서는 복잡한 가족관계 자동판독보다:

- 신청자 resident verification
- business 관계 설명
- 필요한 최소 확인자료
- 운영자 검토

방식으로 시작하는 것을 권장한다.

## 13. 외부 지역 사업자

입주민이 아니어도 지역 business로 참여할 수 있어야 한다.

따라서:

```text
authenticated member
 -> local business application
 -> business verification/review
 -> approved business
```

가 가능해야 한다.

즉 `complex_memberships`가 없는 사용자를 business applicant라는 이유로 차단하지 않는다.

## 14. 사업자 확인 — MVP 제안

MVP에서는 다음을 기본으로 한다.

- business/service name
- category
- description
- contact
- representative image
- service area / availability
- resident benefit optional
- applicant-business relation
- business registration number, 해당 시
- 사업자등록증 등 증빙은 필요할 때 private evidence로 선택적 제출
- manager/admin review

사업자등록번호 실시간 정부조회, OCR, 전화 OTP 등은 후속 자동화 후보로 둔다.

## 15. 승인 후 business 관리권

현재 application 승인 → business materialization 흐름은 이미 존재한다.

후속 schema 고려사항:

- 하나의 business를 여러 user가 관리할 가능성
- 공동대표/가족/직원 권한

따라서 장기적으로 `business_memberships` 또는 동등한 relation table이 적합할 수 있다.

단, 이것은 현재 MVP에서 즉시 migration해야 한다는 확정사항은 아니다. 동생 검토 후 결정한다.

## 16. 관리자 권한

사용자가 UI에서 스스로 manager/admin이 될 수 있게 하지 않는다.

제안:

- `admin`: Padiem 플랫폼 운영권한
- `manager`: 특정 apartment complex 운영권한

권한은 서버-side DB state로 부여하고 모든 admin API가 이를 다시 확인한다.

다른 단지 manager가 현재 단지 데이터를 승인할 수 없어야 한다.

## 17. 내정보를 identity hub로 사용

MVP에서 `내정보`를 자격상태를 한눈에 보는 허브로 만든다.

예:

```text
계정
✓ 로그인됨

방림명지로드힐
✓ 입주민 인증 완료

내 가게·서비스
한결수학
✓ 승인됨

받은 주민혜택
3개
```

미인증이면:

```text
방림명지로드힐
입주민 인증 필요
[인증 시작]
```

사업이 없으면:

```text
내 가게·서비스
등록된 일이 없습니다.
[내 일 알리기]
```

## 18. 개인정보/공개정책

공개 business surface에 노출하지 않는 정보:

- 정확한 동/호수
- resident evidence original
- 사업자 확인문서 original
- private personal phone unless policy explicitly permits verified-only route
- manager internal review notes
- 실명과 exact residence의 결합정보

공개 표현은 예를 들어:

`방림명지로드힐 주민 운영`

정도까지로 제한하고,

`101동 1203호 김OO 운영`

같은 표현은 금지한다.

## 19. 권한 테스트 matrix — 필수

최종 MVP 전에 적어도 다음을 deployed environment에서 검증한다.

| Actor | Action | Expected |
|---|---|---|
| Guest | public business read | allow |
| Guest | resident-only contact | deny |
| Auth member / unverified | resident benefit claim | deny |
| Verified resident | resident benefit claim | allow |
| Verified resident | own business application | allow |
| Local non-resident member | local business application | proposed allow |
| Resident | admin approval API | deny |
| Manager same complex | review permitted target | allow |
| Manager other complex | review current complex | deny |
| Banned/invalid auth | private API | deny |

## 20. 개발 재개 Gate

### AUTH-0 — Decision freeze

동생과 이 문서를 검토하고 아래 open questions를 확정한다.

### AUTH-1 — Neon Auth runtime

- actual Auth base URL
- JWKS URL/derivation
- preview child Auth/runtime behavior

확인.

### AUTH-2 — Browser login

- provider UI
- login/logout
- session restore
- refresh persistence

### AUTH-3 — Bearer integration

Browser session access JWT를 Worker의 `Authorization: Bearer`에 연결.

### AUTH-4 — Product identity bootstrap

첫 login → `app_users`만 생성/resolve되는지 live 검증.

### AUTH-5 — Resident verification

`member → apply → pending → manager review → verified`

### AUTH-6 — Business verification

`member/resident → application → review → approved business`

### AUTH-7 — Authorization regression

위 matrix 전체 검증.

### AUTH-8 — Deployed vertical E2E

```text
login
 -> resident verification
 -> manager approval
 -> resident benefit/private access
 -> business application
 -> manager approval
 -> public business discovery
```

전체를 Neon child + Cloudflare Preview에서 검증.

## 21. 동생과 반드시 결정할 Open Questions

1. MVP login provider: Google + 이메일로 갈 것인가?
2. 이메일 방식: OTP vs magic link 중 무엇인가?
3. 첫 단지에서 resident code/QR을 실제 운영할 수 있는가?
4. code는 세대별/1회용/기간제 중 무엇으로 만들 것인가?
5. code 없는 주민의 최소 증빙은 무엇인가?
6. local external business를 MVP부터 받을 것인가?
7. 주민가족 사업자의 최소 확인기준은 무엇인가?
8. business 관리자는 MVP에서 1명만 둘 것인가?
9. resident evidence / business evidence의 보존기간은 얼마로 할 것인가?
10. MVP는 preview 승인 후 전달할지, production deploy까지 끝내고 전달할지?

## 22. 현재 판정

현재 backend identity/authorization foundation은 이미 상당 부분 구현돼 있다.

다음 문제는 단순 `로그인 버튼 추가`가 아니라:

**login identity → apartment qualification → business qualification → authorization**

의 실환경 연결을 정확히 닫는 것이다.

이 정책을 동생과 확정하기 전에는 신규 Auth UI 개발을 재개하지 않는다.
