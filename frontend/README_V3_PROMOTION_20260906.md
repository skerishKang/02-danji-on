# 프론트엔드 v3 승격 안내 — 2026-09-06

## 결정
이웃가게 A/B 비교에서 **v3(index3/app3)를 정식 기준으로 채택**했습니다.
버전2(index2/app2) 브랜치 `design/frontend-v2-wip-20260906`는 역사 보존용으로 유지하며 더 이상 수정하지 않습니다.

## 백엔드 연결 대상 (Source of Truth)
- 웹 진입: `frontend/index3.html`
- 앱 진입(390×844 확인용 셸): `frontend/app3.html`
- 이웃가게 본체: `frontend/01_이웃가게_발견_v3.html`
- 주민혜택: `frontend/03_주민혜택_쿠폰.html` (A안과 동일 파일)

## 이번 브랜치에서 바뀐 파일
- 신규: `index3.html`, `app3.html`, `01_이웃가게_발견_v3.html`
- 갱신(공용): `assets/consistency.js`, `04_데일리홈.html`, `05_우리단지_첫화면.html`, `19_내정보_메인.html`, `25A_신청제보.html`
  - v3 라우팅 분기 추가(기존 v2/A 동작은 유지)
  - 내정보 → 하위 화면 → 뒤로가기 시 스크롤 위치 복원 추가
- 원본 008 폴더 기준: 구글드라이브 `008_프론트엔드점검1기_통합수정본_20260904` (390×844 브라우저 전 동선 실측 완료: 진입→홈→이웃가게→가게 팝업→후기 등록 토스트→가게 문의 접수 토스트→내정보 위치 복귀)

## 백엔드 연결 시 교체 대상(프론트 시제품 상태)
- sessionStorage/localStorage 임시 상태(저장 가게 `danjion:savedShops`, 보관 혜택, 가게 문의 `danjion:demo:shop-inquiries`, 회원 상태 플래그) → 실제 계정/DB
- 가게 문의는 메시지 스레드로: 화면 표시 = 가게명, 실제 수신 = shops.owner_user_id (별도 결정문: `DANJION_BACKEND_DECISION_SHOP_MESSAGE_IDENTITY_20260905.md`)
- UI/동선은 임의 재설계하지 말 것 (Owner DELTA만)
