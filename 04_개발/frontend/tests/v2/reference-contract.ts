export const V2_REFERENCE = {
  source: {
    driveFileId: '1aFaUaB1HIpb5iVaDvi_fJUYWs5i29MYB',
    sha256: 'AE736CFD66D53D72D94DAC7EAC2FDBCB6864C6C05680E61E748DA6576B7F22CC',
    title: '01_CURRENT_GATE1_RENDER.html',
    // Historical motion recording remains a motion donor only. The current visual
    // source of truth is the sibling Gate1 render pinned above. Product-flow copy
    // may evolve when required to preserve a stronger ownership/data contract,
    // but section order, composition, imagery, and interaction hierarchy remain locked.
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
    heroHeading: '우리 아파트에, 단지온이 켜졌습니다.',
    heroSearchPlaceholder: '무슨 일이 필요하세요?',
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
  hero: ['[data-v2-section="hero"]', '.hero'],
  heroImage: ['[data-v2-hero-image]', '.hero-photo img.bg', '.hero-photo img'],
  cinematic: ['[data-v2-section="cinematic"]', '#liveScenes', '.scene-world'],
  cinematicStage: ['[data-v2-cinematic-stage]', '#sceneStage', '.scene-sticky'],
  cinematicPanel: ['[data-v2-cinematic-panel]', '#scenePanel', '.scene-panel'],
  sceneTabs: ['[data-v2-scene-tab]', '.scene-tab'],
  discovery: ['[data-v2-section="discovery"]', '#shops', '.shops'],
  benefits: ['[data-v2-section="benefits"]', '#benefits', '.benefits'],
  registration: ['[data-v2-section="registration"]', '#register', '.role-shift'],
  promo: ['[data-v2-section="promo"]', '#promo', '.promo'],
  ending: ['[data-v2-section="ending"]', '#ending', '.ending'],
  mobileNav: ['[data-v2-mobile-nav]', '.mobile-nav'],
  topProgress: ['[data-v2-top-progress]', '#topProgress', '.top-progress']
} as const;
