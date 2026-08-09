export type V2ImageKey = 'food' | 'learning' | 'home' | 'professional' | 'craft' | 'car' | 'beauty' | 'photo';
export type V2SceneKey = 'food' | 'learning' | 'home' | 'professional';
export type V2CategoryKey = 'food' | 'learning'' | 'home' | 'professional' | 'creative' | 'beauty';
export type V2RelationKey = 'resident' | 'family' | 'neighbor' | 'partner';

export type V2ReferenceImage = {
  key: V2ImageKey;
  src: string;
  fallbackAsset: string;
  alt: string;
};

export type V2Scene = {
  index: number;
  key: V2SceneKey;
  name: string;
  caption: string;
  captionText: string;
  copy: string;
  relation: string;
  price: string;
  benefit: string;
  status: string;
  image: V2ReferenceImage;
  color: string;
  ink: '#111' | '#fff';
  dark: string;
  shopId: string;
};

export type V2ShopVisual = {
  id: string;
  name: string;
  category: V2CategoryKey;
  relation: V2RelationKey;
  image: V2ReferenceImage;
  desc: string;
  services: string;
  price: string;
  area: string;
  benefit: string;
  availability: string;
  color: string;
};

export const V2_REFERENCE_IMAGES: Record<V2ImageKey, V2ReferenceImage> = {
  food: {
    key: 'food',
    src: 'https://images.unsplash.com/photo-1691502511721-a868792ab923?auto=format&fit=crop&w=1800&q=82',
    fallbackAsset: '05_실행자산/scene-food.webp',
    alt: '주방에서 반찬을 준비하는 손과 작업대'
  },
  learning: {
    key: 'learning',
    src: 'https://images.unsplash.com/photo-1758685733926-00cba008215b?auto=format&fit=crop&w=1800&q=82',
    fallbackAsset: '05_실행자산/scene-learning.webp',
    alt: '교사와 학생이 함께 문제를 푸는 수업 장면'
  },
  home: {
    key: 'home',
    src: 'https://images.unsplash.com/photo-1768839725085-829e6ac7ac26?auto=format&fit=crop&w=1800&q=82',
    fallbackAsset: '05_실행자산/scene-home-care.webp',
    alt: '생활 설비를 점검하고 보수하는 손과 공구'
  },
  professional: {
    key: 'professional',
    src: 'https://images.unsplash.com/photo-1772588627373-729b0f47e5bb?auto=format&fit=crop&w=1800&q=82',
    fallbackAsset: '05_실행자산/scene-professional.webp',
    alt: '서류와 계산기를 살피며 상담을 준비하는 손'
  },
  craft: {
    key: 'craft',
    src: 'https://images.unsplash.com/photo-1782061932586-c8a425a67e3f?auto=format&fit=crop&w=1800&q=82',
    fallbackAsset: '05_실행자산/scene-craft.webp',
    alt: '꽃과 소품을 손으로 다듬어 만드는 작업 장면'
  },
  car: {
    key: 'car',
    src: 'https://images.unsplash.com/photo-1775590766345-c117265f0c1b?auto=format&fit=crop&w=1800&q=82',
    fallbackAsset: '05_실행자산/scene-car.webp',
    alt: '자동차 엔진과 부품을 점검하는 정비 장면'
  },
  beauty: {
    key: 'beauty',
    src: 'https://images.unsplash.com/photo-1761931403671-d020a14928d9?auto=format&fit=crop&w=1800&q=82',
    fallbackAsset: '05_실행자산/scene-beauty.webp',
    alt: '미용 도구를 사용해 손질하는 작업 장면'
  },
  photo: {
    key: 'photo',
    src: 'https://images.unsplash.com/photo-1686075790932-5f1484a9784f?auto=format&fit=crop&w=1800&q=82',
    fallbackAsset: '05_실행자산/scene-photo.webp',
    alt: '카메라를 조작하며 촬영을 준비하는 작업 장면'
  }
};

export const V2_CATEGORY_LABELS: Record<V2CategoryKey, string> = {
  food: '먹고 마시는 일',
  learning: '배우고 가르치는 일',
  home: '집을 돌보는 일',
  professional: '사업을 돕는 일',
  creative: '만들고 기록하는 일',
  beauty: '몸과 마음을 돌보는 일'
};

export const V2_RELATION_LABELS: Record<V2RelationKey, string> = {
  resident: '현재 단지 주민 직접 운영',
  family: '현재 단지 주민 가족 운영',
  neighbor: '이웃 단지 주민 운영',
  partner: '일반 동네 제휴가게'
};

export const V2_SCENES: V2Scene[] = [
  {
    index: 0,
    key: 'food',
    name: '오늘의 반찬',
    caption: '반찬을 만드는 이웃',
    captionText: '손질하고, 볶고, 담는 과정이 먼저 보이면 이웃의 일이 광고문구보다 빨리 이해됩니다.',
    copy: '매일 먹는 반찬을 직접 만들고 포장하는 이웃입니다.',
    relation: '현재 단지 주민 직접 운영',
    price: '메뉴별 가격 · 예약 주문',
    benefit: '방림명지로드힐 주민 10%',
    status: '입주민 관계 확인 완료',
    image: V2_REFERENCE_IMAGES.food,
    color: '#E95C3E',
    ink: '#111',
    dark: '#4A1F17',
    shopId: 'food-01'
  },
  {
    index: 1,
    key: 'learning',
    name: '한결수학',
    caption: '수학을 가르치는 이웃',
    captionText: '칠판과 노트, 설명하는 손이 이어지면 “과외”라는 기능명이 실제 수업 장면으로 바뀝니다.',
    copy: '중·고등학생에게 문제를 푸는 이유부터 설명하는 수학 과외입니다.',
    relation: '현재 단지 주민 직접 운영',
    price: '중학생 월 32만원 · 고등학생 상담',
    benefit: '방림명지로드힐 학생 첫 수업 무료',
    status: '입주민 관계 확인 완료',
    image: V2_REFERENCE_IMAGES.learning,
    color: '#4057E8',
    ink: '#fff',
    dark: '#18265E',
    shopId: 'learning-preview'
  },
  {
    index: 2,
    key: 'home',
    name: '온케어 홈서비스',
    caption: '집과 생활을 고치는 이웃',
    captionText: '작업도구와 분해된 부품을 가까이 보여주고, 정보는 뒤늦게 따라오게 해 실제 서비스의 손맛을 남깁니다.',
    copy: '보이지 않는 곳까지 분해하고 씻고 점검하는 생활관리 서비스입니다.',
    relation: '현재 단지 주민 가족 운영',
    price: '에어컨 1대 7만원부터',
    benefit: '방림명지로드힐 출장비 면제',
    status: '주민 가족 관계 확인 완료',
    image: V2_REFERENCE_IMAGES.home,
    color: '#BDE53E',
    ink: '#111',
    dark: '#384217',
    shopId: 'home-01'
  },
  {
    index: 3,
    key: 'professional',
    name: '바른 세무상담',
    caption: '사업과 문서를 돕는 이웃',
    captionText: '화려한 오브젝트 대신 손과 서류를 가까이 두고, 선택 후 정보 패널이 앞으로 오며 상담 기준을 읽게 합니다.',
    copy: '사업자와 개인이 준비한 문서를 함께 보며 세금과 사업 절차를 설명합니다.',
    relation: '현재 단지 주민 직접 운영',
    price: '첫 상담 30분 기준',
    benefit: '방림명지로드힐 첫 상담 무료',
    status: '입주민 관계 확인 완료',
    image: V2_REFERENCE_IMAGES.professional,
    color: '#6840A5',
    ink: '#fff',
    dark: '#2E173D',
    shopId: 'pro-01'
  }
];

export const V2_SAMPLE_SHOPS: V2ShopVisual[] = [
  {
    id: 'food-01', name: '오늘의 반찬', category: 'food', relation: 'resident', image: V2_REFERENCE_IMAGES.food,
    desc: '매일 먹는 반찬을 직접 만들고 예약 주문으로 준비하는 이웃입니다.', services: '반찬 · 김치 · 계절 메뉴', price: '메뉴별 가격 · 예약 주문', area: '방림명지로드힐 생활권 · 포장', benefit: '방림명지로드힐 주민 10% 할인', availability: '평일 오전 10시–오후 7시', color: '#E95C3E'
  },
  {
    id: 'home-01', name: '온케어 홈서비스', category: 'home', relation: 'family', image: V2_REFERENCE_IMAGES.home,
    desc: '보이지 않는 곳까지 분해하고 세척·점검하는 생활관리 서비스입니다.', services: '에어컨 청소 · 세탁기 청소 · 생활 점검', price: '에어컨 1대 7만원부터', area: '방림동 방문 서비스', benefit: '방림명지로드힐 출장비 면제', availability: '평일·토요일 예약', color: '#BDE53E'
  },
  {
    id: 'pro-01', name: '바른 세무상담', category: 'professional', relation: 'resident', image: V2_REFERENCE_IMAGES.professional,
    desc: '사업자와 개인이 준비한 문서를 함께 보며 세금·사업 절차를 설명하는 이웃입니다.', services: '세무 · 사업자등록 · 기초 문서상담', price: '첫 상담 30분 기준', area: '비대면 또는 인근 상담', benefit: '방림명지로드힐 첫 상담 무료', availability: '평일 오후 · 예약', color: '#6840A5'
  },
  {
    id: 'craft-01', name: '꽃담 공방', category: 'creative', relation: 'resident', image: V2_REFERENCE_IMAGES.craft,
    desc: '손으로 만드는 꽃과 생활 소품을 주문에 맞춰 제작합니다.', services: '꽃 · 소품 · 기념 선물', price: '상품별 주문 상담', area: '방림동 수령 또는 인근 전달', benefit: '주민 10% 할인', availability: '주 5일 주문 상담', color: '#C56A45'
  },
  {
    id: 'car-01', name: '우리동네 자동차정비', category: 'home', relation: 'neighbor', image: V2_REFERENCE_IMAGES.car,
    desc: '기본 점검과 소모품 교체부터 하체 점검까지 직접 설명하는 이웃 단지 정비업입니다.', services: '차량 점검 · 오일 · 소모품 · 하체', price: '점검 후 견적 안내', area: '남구 생활권', benefit: '주민 공임 할인', availability: '월–토 오전 9시–오후 6시', color: '#63714A'
  },
  {
    id: 'beauty-01', name: '정다운 헤어', category: 'beauty', relation: 'family', image: V2_REFERENCE_IMAGES.beauty,
    desc: '가족이 운영하는 생활 미용 서비스로 커트와 기본 관리를 제공합니다.', services: '커트 · 염색 · 기본 케어', price: '커트 18,000원부터', area: '방림동 인근', benefit: '입주민 커트 할인', availability: '화–일 예약 우선', color: '#A65B73'
  },
  {
    id: 'photo-01', name: '사진하는 이웃', category: 'creative', relation: 'resident', image: V2_REFERENCE_IMAGES.photo,
    desc: '가족사진과 프로필을 자연스럽게 촬영하고 기본 보정을 제공합니다.', services: '가족사진 · 프로필 · 소규모 촬영', price: '촬영 6만원부터', area: '광주 생활권 출장', benefit: '입주민 촬영비 할인', availability: '주말·평일 저녁 예약', color: '#2F5A72'
  }
];