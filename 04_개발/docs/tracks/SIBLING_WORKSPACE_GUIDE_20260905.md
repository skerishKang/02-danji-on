# [동생 워크스페이스 가이드] — muphobia2/danjion → skerishKang/02-danji-on

- 상태: CURRENT — 2026-09-05 (import 머지 `abbd6e7` 기준)
- 목적: 동생 저장소(`muphobia2/danjion`)의 작업 기준을 이 저장소(`skerishKang/02-danji-on`)로 단일화. 동생은 이제 **이 저장소**에서 작업한다.
- 권한: 동생 계정에 collaborator 초대 완료 (소유자 확인)

---

## 1. 시작하기

```bash
git clone https://github.com/skerishKang/02-danji-on.git
cd 02-danji-on
git checkout main && git log --oneline -1   # abbd6e7 이상이 보여야 정상
```

이전에 쓰던 `muphobia2/danjion` 저장소는 **더 이상 작업 기준이 아니다.** 앞으로의 변경은 이 저장소에만 반영한다.

---

## 2. 저장소 구조

| 경로 | 내용 | 작업 주체 |
| --- | --- | --- |
| `frontend/` | 동생이 가져온 HTML 32화면 + assets(10) + 약관 JPG(4) + README | 동생 (기준 유지·개선) |
| `backend/` | Cloudflare Workers API — 라우트 12, 마이그레이션 6, wrangler.jsonc | 동생 (기준 유지·개선) |
| `auth-test/` | 관리자/가게/phase3 테스트 하네스 | 동생 |
| `04_개발/frontend/` | 1기 React·TS 구현 (패리티 계약 16종) | 1기 개발 |
| `04_개발/backend/` | 1기 백엔드 구현 + 계약 테스트 | 1기 개발 |
| `03_HTML결과물/` | 이전 디자인 라운드(v1~v7, M1) | 아카이브 |
| `00_공통기준문서/` | 제품·의사결정 기준 (CURRENT) | 공통 |
| `04_개발/docs/` | CTO 산출물·트랙 작업지시서·판정 | 공통 |

주의: 루트 `frontend/`·`backend/`는 **동생 전용 워크스페이스**, `04_개발/frontend`·`04_개발/backend`는 **1기 구현**이다. 서로 다른 산출물이므로 혼동하지 말 것.

---

## 3. 작업 워크플로

1. `main`에서 작업 브랜치 생성: `git checkout -b feat/<내용>`
2. 변경 후 **Draft PR** 생성 (base `main`)
3. PR에 변경 파일 목록·검증 결과·커밋 해시를 기록
4. **머지는 하지 않는다** — CTO(웹 모델) 승인 후 머지
5. 완료 보고는 커밋/푸시 후 브랜치 이름과 커밋 해시를 채널에 남긴다

전달 채널은 **GitHub뿐**이다. rclone/구글드라이브/채팅 첨부는 CTO가 읽을 수 없다.

---

## 4. 변경 금지 (HOLD) — 소유자 결정 없이는 구현·추론 금지

- **23 이웃온기**: 웜스(온기) 점수 공식 / 이벤트 가중치 / 페널티 (`#263`)
- **03 주민혜택 쿠폰**: reserve·onsite·coupon delivery-mode 서버 권한 (`#253`, `#139`)
- **개인정보 처리주체·주민인증**: `#59` 확정 전까지 경계 변경 금지

---

## 5. 현재 열려 있는 사항

| 번호 | 상태 | 내용 |
| --- | --- | --- |
| delta 판정 | CTO 판정 대기 | import된 `frontend/` 중 008 대비 **11개 화면**이 다름 — 보고서 `04_개발/docs/tracks/TRACK_SIBLING_LATEST_DELTA_REPORT_20260905.md`(PR #273). 동생 frontend를 기준선으로 유지하는 방향으로 판정 예정 |
| #245 | OPEN | Post-V2 안정화 리팩터링 웨이브 (다음 개발 후보) |

---

## 6. 검증 게이트 (동생이 만든 변경이 건드린 영역 기준)

```bash
# backend (동생 백엔드)
cd backend && npm ci && npx wrangler types 2>/dev/null; npm run typecheck 2>/dev/null
# frontend HTML (동생 프론트) — 브라우저에서 화면 동작 확인
# 1기 영역을 건드렸다면 아래도 통과해야 함
cd 04_개발/frontend && npm ci && npm run typecheck && npm run test:v2-complex-news-contract && npm run build
```

---

## 7. 예외·비고

- `backend/.dev.vars.example`은 커밋 대상이고, 실제 `.dev.vars`는 `.gitignore`로 제외된다. secret은 코드/로그/PR/채팅에 넣지 않는다.
- `새 텍스트 문서.txt`(0KB)는 import 당시 동생 저장소에 있던 파일로 원본 그대로 보존 중. 정리하려면 별도 지시를 받을 것.
