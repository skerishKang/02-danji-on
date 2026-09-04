export const V2_REFERENCE = {
  source: {
    driveFileId: '1j0f5-UyK012HKuny4xsbZchbYXJ3oVsX',
    sha256: '267F6BAC8EF83A4AAC85D7D3C69A68A3901F652F2B59003C735575245C487110',
    title: '04_데일리홈.html',
    // The 2026-09-04 integrated frontend audit is the current home authority.
    // Historical Gate1 sources remain useful provenance/motion donors only and
    // must not override the current 04 app-content composition.
    recordingDriveFileId: '13kpM0HeS_WG9lXbuWk9uVvbBConKJ6ai',
    recordingDurationSeconds: 115.472834,
    recordingViewport: { width: 1920, height: 1080 }
  },
  viewports: {
    desktop: { width: 1440, height: 1000 },
    tablet: { width: 1024, height: 900 },
    mobile390: { width: 390, height: 844 },
    mobile320: { width: 320, height: 720 }
  },
  copy: {
    heroHeading: '필요한 일, 우리 단지에서 먼저 찾습니다.',
    heroSearchPlaceholder: '반찬 · 과외 · 청소 · 세무',
    discoveryHeading: '가까운 사람의 일을 먼저 보여줍니다.',
    benefitHeading: '혜택이 실제 행동이 됩니다.',
    registrationHeading: '내 일은 등록하고, 좋은 이웃가게는 추천합니다.',
    promoHeading: '입력한 생활정보가 홍보물로 정돈됩니다.',
    endingHeading: '우리 단지의 소비가 우리 이웃의 일로 이어집니다.'
  },
  scenes: [
    { key: 'food', tabName: '01 반찬을 만드는 이웃', heading: '반찬을 만드는 이웃', service: '오늘의 반찬', accent: '#E95C3E' },
    { key: 'learning', tabName: '02 수학을 가르치는 이웃', heading: '수학을 가르치는 이웃', service: '한결수학', accent: '#4057E8' },
    { key: 'home', tabName: '03 집과 생활을 고치는 이웃', heading: '집과 생활을 고치는 이웃', service: '온케어 홈서비스', accent: '#BDE53E' },
    { key: 'professional', tabName: '04 사업과 문서를 돕는 이웃', heading: '사업과 문서를 돕는 이웃', service: '바른 세무상담', accent: '#6840A5' }
  ],
  categoryFilters: ['전체', '먹고 마시는 일', '배우고 가르치는 일', '집을 돌보는 일', '사업을 돕는 일', '만들고 기록하는 일'],
  relationFilters: ['전체', '우리 단지 주민', '주민 가족', '이웃 단지', '일반 제휴'],
  registration: {
    ownerTrigger: '등록 또는 추천',
    ownerRelation: '현재 단지 주민 직접 운영 · 내 가게 등록',
    recommendationRelation: '이웃 단지 주민 운영 · 이웃가게 추천',
    recommendationSubmit: '이웃가게 추천 접수',
    steps: [
      '주민 관계를 선택하세요',
      '기본 정보를 확인하세요',
      '사진과 주민혜택을 정하세요',
      '공개정보와 비공개 정보를 확인하세요'
    ],
    promoOutputs: ['단지온 가게소개 카드', '카카오톡 공유 이미지', '엘리베이터 게시판 포스터'],
    operatorPublic: '공개정보 확인',
    operatorPrivate: '비공개 주민관계 확인'
  }
} as const;

export const V2_SELECTORS = {
  root: '[data-ui-variant="v2"]',
  topbar: ['[data-v2-topbar]', '.topbar'],
  hero: ['[data-v2-section="hero"]', '.home-intro'],
  heroImage: ['[data-v2-section="cinematic"] .v2-scene-image', '.stage .scene-image'],
  cinematic: ['[data-v2-section="cinematic"]', '.stage-wrap'],
  cinematicStage: ['[data-v2-cinematic-stage]', '.stage'],
  cinematicPanel: ['[data-v2-cinematic-panel]', '.panel'],
  sceneTabs: ['[data-v2-scene-tab]', '.scene-tab'],
  discovery: ['[data-v2-section="discovery"]', '#shops', '.shops'],
  benefits: ['[data-v2-section="benefits"]', '#benefits', '.benefits'],
  registration: ['[data-v2-section="registration"]', '#register', '.role-shift'],
  promo: ['[data-v2-section="promo"]', '#promo', '.promo'],
  ending: ['[data-v2-section="ending"]', '#ending', '.ending'],
  mobileNav: ['[data-v2-mobile-nav]', '.mobile-bottom'],
  topProgress: ['[data-v2-top-progress]', '#topProgress', '.top-progress']
} as const;
