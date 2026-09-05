# [sibling-latest 델타 조사 보고]

- 상태: SUBMITTED (CTO 판정 대기) — 2026-09-05
- 조사 성격: read-only. 구현 코드 작성 없음 (`PRODUCTION_MUTATION = 0`)
- 기준 A: `008_프론트엔드점검1기_통합수정본_20260904/` (로컬 핸드오프 폴더, git 비관리)
- 기준 B: `sibling/main`(`1098e77` "Add files via upload") 을 `sibling-latest` 브랜치로 격리 후 `git archive --format=zip` + Extract 로 추출한 `frontend/`
- 저장소: `https://github.com/muphobia2/danjion.git` (remote alias: `sibling`)

---

## ① 대조 결과: **변경 발생**

| 구분 | 결과 |
| --- | --- |
| HTML 화면 | 32 vs 32 — **21건 해시 동일**, **11건 실질 변경** |
| `app.html` | 해시 일치 (008에도 존재, 변경 없음) |
| 에셋 10종 | `bangnim-road-hill.png`, `consistency.css/js`, `home-florist.png`, `neighbors-8.png`, `roadhill-evening.png`, `scene-car/food/learning/photo.webp` — **전부 해시 일치** |

판정 포인트: 화면 본체(마크업·디자인)와 공용 에셋은 008과 동일하지만, **11개 화면에 2기 시점의 기능·보정 추가분**이 얹혀 있음.

---

## ② 실질 변경 파일 목록 및 변경 요약 (11건)

| 파일 | diff 규모 | 변경 내용 | 성격 |
| --- | --- | --- | --- |
| `28_나의활동.html` | +209/−4 | `<style id="frontcheck1-saved-benefit-card-modal-20260905">` — 저장 혜택(visual-special)/가게(visual-shop) 카드 모달 CSS 대폭 추가 | 2기 CSS |
| `04_데일리홈.html` | +102/−11 | 검색바 `grid-template-columns:54px minmax(0,1fr) 54px` + 좌우 border + svg·버튼 크기 조정, 데일리홈 scene UI 변경 | 2기 CSS |
| `02_이웃가게_상세.html` | +86/−2 | `<style id="frontcheck-shop-write-sheet-20260904">` — 가게 등록/신청 시트(shop-form-layer/scrim/sheet, 데스크톱+바텀시트) CSS | 2기 CSS |
| `24_설정.html` | +69/−3 | 계정 관리 시트 **실동작화** — `account-layer` HTML+`frontcheck-account-sheet-script-20260904`, 가입 이메일/로그인·비밀번호/로그아웃이 `data-demo` → `data-account-open` 으로 변경, "우리단지 새 소식" 카피 순서 변경 | 실기능화 |
| `19_내정보_메인.html` | +41/−2 | 밀도 보정 CSS 2종(`frontcheck-myinfo-density-final-20260904`, `frontend2-myinfo-side-action-room-20260905`) + 메뉴 라우팅 분기(3번째→`?view=saved`, 4번째→`?view=benefits`) | 2기 CSS + 라우팅 |
| `26_우리집연결.html` | +40/−1 | 가족 초대링크 **실동작화** — `household-share-actions-20260904`(새 링크 생성/클립보드 복사/sms/native share), `data-demo` → `data-invite-action`/`data-share` | 실기능화 |
| `06_단지온공지_목록.html` | +22/−3 | 공지 **검색 실동작화** — 필터+검색어 AND 결합(`applyNoticeFilter`), 빈 결과 안내(`#noticeEmpty`), 헤드 타이틀 "검색 결과" 전환 | 실기능화 |
| `10_주민소식_목록.html` | +20/−2 | **파일 첨부 실동작화** — hidden input(최대 3개, image/pdf/hwp/doc/ppt)+`resident-file-picker-20260904` 목록 렌더링, 안내 문구 | 실기능화 |
| `25A_신청제보.html` | +18/−6 | `danjion:shopVariant` 브리지 — sessionStorage 기반 `index2.html`/`01_이웃가게_발견_v2.html` 분기, FILES 매핑 동적화 | 실기능화(분기) |
| `index.html` | +1 | `<head>`에 `sessionStorage.removeItem("danjion:shopVariant")` 초기화 스크립트 | 분기 초기화 |
| `01_이웃가게_발견.html` | +5/−2 | 모바일 `.shop-grid` margin `12px -20px 0` → `12px 0 0` | 2기 CSS |

요약:
- **2기 보정 CSS** (`frontcheck-*`/`frontend2-*` 스타일 블록, `20260904`/`20260905` 날짜 포함): 01/02/04/19/28
- **실기능화** (디자인 시제품 → 실제 동작): 06(검색), 10(파일 첨부), 24(계정 시트), 26(초대링크 공유), 25A+index(shopVariant 분기)
- 카피 순서 변경 1건: 24 (단지온공지·아파트소식·주민소식 → 단지온공지·아파트소식·주민소식 순서 조정)

---

## ③ 비화면 추가 파일 (008 대비)

### frontend/ (추가 6건)
| 파일 | 크기 | 내용 |
| --- | --- | --- |
| `frontend/README.md` | — | "DanjiOn Frontend 최종 기준본" 안내 (index/app/QA/백엔드 인계 링크) |
| `frontend/개인정보수집이용.JPG` | 65.3KB | 약관/동의 화면 캡처 |
| `frontend/단지온이용약관.JPG` | 62.2KB | 약관/동의 화면 캡처 |
| `frontend/서비스알림수신.JPG` | 59.7KB | 약관/동의 화면 캡처 |
| `frontend/혜택이벤트알림.JPG` | 54.3KB | 약관/동의 화면 캡처 |
| `frontend/새 텍스트 문서.txt` | 0KB | 빈 파일 |

### 신규 디렉토리 (008에 없던 것)
| 디렉토리 | 파일 수 | 내용 |
| --- | --- | --- |
| `auth-test/` | 10 | 관리자/가게/phase3 인증 테스트 환경 — `admin-list.html`, `business-test.html`, `index.html`, `phase3-storage-test.html`, `phase3-test.html`, `status.html`, `src.js` + `package.json`/`package-lock.json`/`vite.config.js` |
| `backend/` | 30 | Cloudflare Workers 기반 API — 라우트 12종(hello/me/buildings/complexes/businesses/business-discovery/business-applications/business-files/business-management/admin-*/resident-verifications/test-users) + `auth/verify.js` + `db/client.js` + 마이그레이션 SQL 6종 + `wrangler.jsonc` + `README.md` |

---

## ④ CTO 판정 요청 사항

1. **변경 11건 반영 방향**: ①동생 변경 수용 ②2기 수정 기준(웹)/008 인계 기준 유지 ③선별 반영 — 3안 중 결정 필요.
2. **frontend/ 비화면 6종**(README, JPG 4, txt)과 **auth-test/·backend/**(008에 없던 신규)를 우리 저장소로 가져올지 여부.
3. **실기능화 충돌 검토**: 첫 화면 `danjion:shopVariant` 분기, 공지 검색·파일 첨부·계정 시트·초대링크 공유가 현재 백엔드 연동 계획(Cloudflare Workers API 구조)과 어떤 관계로 두어야 하는지 — 구현 충돌 여부 판단 근거로 위 ①② 목록 제출.

---

## 부록. 재현 방법

```bash
# 기준 B 격리
git remote add sibling https://github.com/muphobia2/danjion.git
git fetch sibling
git checkout -b sibling-latest sibling/main   # 1098e77
git archive --format=zip -o %TEMP%\kilo\sibling-frontend.zip HEAD frontend/
# %TEMP%\kilo\sibling-latest-frontend\frontend 로 Extract 후 SHA256 전수 대조
# 기준 A = 008_프론트엔드점검1기_통합수정본_20260904/
```
