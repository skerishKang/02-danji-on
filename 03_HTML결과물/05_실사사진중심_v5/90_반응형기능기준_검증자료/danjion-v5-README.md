# 단지온 D안 반응형 HTML 제출

## 결과물

- `danjion-neighbor-life-v5-responsive.html`
- 320px, 390px, 768px, 1280px, 1440px 홈 화면 캡처
- 데스크톱·모바일 가게와 서비스 목록 캡처
- 모바일 서비스 상세 캡처
- 전체 페이지 데스크톱·모바일 캡처
- `danjion-v5-qa.json`

기존 v1, v2, v3 시안은 수정하지 않았다.

## 확정 디자인 반영

- 기본 서체: Pretendard Variable
- 워드마크: 01C 기반, 단·지·온 사이를 개별 간격으로 조정
- 데스크톱: 12열, 72px 외곽 여백, 24px 거터, 사진 7열·콘텐츠 5열
- 모바일: 좌우 16px, 8px 기반 간격체계
- 배경 `#F7F7F4`
- 콘텐츠면 `#FFFFFF`
- 본문 `#171717`
- 보조문자 `#66635E`
- 구분선 Strong `#A9A59D`, Standard `#D8D5CE`, Subtle `#ECEAE5`
- 주요 행동 `#D84F32`
- 입주민 확인 `#277A53`

## 모바일 수정사항

- 제목: `필요한 일, / 우리 단지에서 찾아보세요`
- 카드 제목: 16px / 22px / 650
- 입주민 확인: 12px / 18px / 600
- 주민 혜택: 13px / 19px / 650
- 하단 메뉴: 12px, 21px SVG 아이콘, 아이콘–글자 간격 4px
- 하단 고정 메뉴 높이와 안전영역을 고려한 본문 하단 여백 적용
- 320px에서 두 CTA를 세로로 재배치
- 카테고리는 가로 스크롤 대신 2열 버튼으로 재배치

## 반응형 구현 원칙

```css
width: 100%;
min-height: 100dvh;
overflow-x: hidden;
overflow-y: visible;
```

고정 페이지 높이와 페이지 전체 `overflow:hidden`은 사용하지 않았다.

모바일 본문에는 다음과 같은 하단 여백이 적용된다.

```css
padding-bottom: calc(66px + env(safe-area-inset-bottom) + 24px);
```

## 구현된 화면과 동작

- 홈
- 가게와 서비스 목록
- 검색 결과
- 주민 관계 필터
- 서비스 분야 필터
- 가게·서비스 상세
- 사진 갤러리 전환
- 문의 모달
- 찜하기·찜 해제
- 주민혜택
- 단지소식
- 내정보
- 3단계 사업자·서비스 등록
- 데스크톱 상단 메뉴
- 모바일 하단 메뉴
- 검색·CTA·카드·혜택·공지 상호작용

## 검증 결과

| 화면 폭 | 가로 넘침 |
|---:|---:|
| 320px | 0px |
| 390px | 0px |
| 768px | 0px |
| 1280px | 0px |
| 1440px | 0px |

동작 검증:

- 메뉴 경로 전환 통과
- `에어컨` 검색 결과 1개 통과
- 카드 상세 진입 통과
- 문의 모달 통과
- 주민혜택·단지소식·내정보 전환 통과
- 등록 1→2→3단계 전환 통과
- 모바일 본문 하단 여백 90px 확인
- 모바일 하단 메뉴 레이블 12px 확인
- JavaScript page error 없음

오프라인 캡처 환경에서는 외부 CDN 요청을 차단하고 시스템 한글 산세리프 폴백으로 렌더링했다. 실제 HTML은 인터넷 연결 시 Pretendard Variable 웹폰트를 불러온다.

## 사진 자산

프로토타입 사진은 실제 참여 주민이나 업체가 아닌 시안용 이미지다. 정확한 동·호수는 어떤 화면에도 표시하지 않는다.

주요 임시 출처:

- 에어컨 작업: José Andrés Pacheco Cortes, Pexels 5463580
- 반찬·조리: cottonbro studio, Pexels 7254219
- 수학 수업: cottonbro studio, Pexels 7395896
- 자동차 점검: cottonbro studio, Pexels 7564858
- 문서상담: RDNE Stock project, Pexels 7821671
- 촬영 작업: cottonbro studio, Pexels 3584931
- 수제품 제작: cottonbro studio, Pexels 6653222
- 방문 미용·관리: Polina Tankilevitch, Pexels 3738365

시안용 이미지 안내는 사진마다 반복하지 않고 페이지 하단 공통 안내와 사진 출처 모달에 배치했다.
