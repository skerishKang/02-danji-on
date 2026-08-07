# DanjiOn Field Demo Parity v1

## 기준

2026-08-24 현장시연용 Drive 결과물 `단지온_8월현장시연_통합시제품_v1`을 제품 개발본과 대조한다.

이 문서는 디자인 원본을 GitHub로 복제하는 문서가 아니다.

- Drive: 설계·디자인·검증 원본의 기준
- GitHub `04_개발`: 실제 제품 코드의 기준
- 기존 `00~03`: 수정하지 않음
- 현장시연 시제품은 제품 오너 최종 승인 전까지 운영서비스로 간주하지 않음

## 최신 시제품이 검증한 생활경제 순환

`발견 → 검색 → 상세 → 주민혜택 → 내 일 알리기 → 홍보물 만들기 → 운영확인 → 승인 공개 → 다시 발견`

## Parity matrix

| 영역 | Drive 현장시연 v1 | React 제품 개발본 | 판정 / 다음 작업 |
|---|---|---|---|
| 첫 화면 검색 | 첫 화면 즉시 검색 | 구현 | 유지 |
| 입주민 상태 | 확인 상태 표시 | 구현 + 별도 인증 workflow | 제품본 우위 |
| 실제 작업사진 hero | 실사 작업장면 | 이모지/그래디언트 | **P0 이식** |
| 4개 대표 장면 | 반찬/수학/홈서비스/세무 | 없음 | **P0 이식** |
| 시네마틱 장면전환 | desktop scrub + mobile tabs | 없음 | P1 이식 |
| 주민관계 정렬 | 4단계 관계 우선순위 | 구현 | 유지 |
| 검색/카테고리/관계 필터 | 구현 | 구현 | 유지 |
| 상세정보 | 사진/3 crop/가격/지역/혜택/시간 | 정보 구현, 실제 사진 약함 | P1 media 연결 |
| 문의방법 | 구현 | 인증 주민 contact API 경계 구현 | 제품본 우위 |
| 저장 | localStorage | adapter 구현 | 제품본 우위 |
| 주민혜택 받기 | 받기 전→보관 중→사용 완료 | 혜택 목록만 | **P0 이식** |
| 내정보 혜택지갑 | 구현 | 미구현 | P0 이식 |
| 내 일 알리기 | 실제 4단계 wizard | **2026-08-08 4단계 wizard로 이식 완료** | 완료 |
| 공개/비공개 확인 | 4단계 마지막 화면 | **4단계 마지막 화면에 반영 완료** | 완료 |
| 대표 이미지 | 등록 사진 선택 | StorageAdapter + preview | 제품본 우위 |
| 홍보물 만들기 | 소개카드/카카오/엘리베이터 3종 | 없음 | P1 이식 |
| 운영 확인 | 공개/비공개 영역 분리 | 별도 `/admin.html` | 제품 구조 유지 |
| 보완 요청/재제출 | 구현 | 구현 + audit | 제품본 우위 |
| 승인 후 공개 | 7→8 공개 | 승인 후 mock business materialize | 구현 |
| 검토 이력 | 최신 상태 중심 | immutable audit trail | 제품본 우위 |
| 큰 글자 | 구현 | 미구현 | P1 |
| 모션 줄이기 | 구현 + prefers-reduced-motion | CSS 일부 + axe | P1 설정 UI |
| 시연 초기화 | 구현 | 테스트 helper만 | 개발 전용 reset 필요 시 추가 |
| 모바일 5탭 | 구현 | 구현 | 유지 |
| 320px overflow | 검증 | Playwright 검증 | 유지 |
| 접근성 | 수동 기준 검증 | axe serious/critical Gate | 제품본 우위 |
| Idempotency | 없음 | 등록 신청에 구현 | 제품본 우위 |
| 입주민 인증 신청/관리 | 시연 범위 밖 | 별도 workflow 구현 중 | 제품본 확장 |

## P0 다음 구현

1. Drive의 검증된 실제 작업사진 자산을 `04_개발/frontend/public/field-demo/`에 이식한다.
2. 첫 화면의 이모지 장면을 실제 작업사진 기반 `CinematicNeighborScenes`로 교체한다.
3. desktop은 사용자의 직접 선택을 우선하고 제한적 progress 전환만 사용한다.
4. mobile은 sticky scrub을 강제하지 않고 4개 탭으로 전환한다.
5. 기능 검색 UI는 장면보다 앞선 우선순위를 유지한다.
6. `prefers-reduced-motion`에서는 clip/zoom/ghost transition을 제거한다.

## P0 이후

- 주민혜택 wallet 상태
- 상세 media/gallery
- 홍보물 3종 출력
- 큰 글자/모션 줄이기 설정
- URL query/filter state
- 실제 인프라 연결 후 API E2E
