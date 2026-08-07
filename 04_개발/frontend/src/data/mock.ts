import type { Benefit, Business, ComplexPost } from '../types';

const rawBusinesses: Array<Omit<Business, 'activeBenefit'>> = [
  { id:'v5-1', kind:'shop', name:'정다운 반찬가게', categorySlug:'food', categoryName:'음식점·반찬·카페', relationType:'resident', summary:'매일 아침 만드는 국과 밑반찬', description:'방림동과 인근 주민이 편하게 이용할 수 있는 반찬가게입니다.', priceText:'반찬 4,000원부터', serviceArea:'방림동과 인근 지역', availabilityText:'평일 오전 9시~오후 7시', icon:'🍱' },
  { id:'v5-2', kind:'shop', name:'한결 자동차 정비', categorySlug:'auto', categoryName:'자동차 정비', relationType:'resident', summary:'엔진오일·타이어·경정비 상담', description:'생활 경정비와 기본 점검을 안내합니다.', priceText:'상담 후 안내', serviceArea:'광주 남구와 인근 지역', availabilityText:'평일 오전 9시~오후 7시', icon:'🚗' },
  { id:'v5-3', kind:'service', name:'온케어 에어컨 청소', categorySlug:'home-service', categoryName:'청소·수리·에어컨 서비스', relationType:'resident', summary:'가정용 에어컨 분해 세척과 점검', description:'에어컨을 분해 세척하고 조립 상태까지 확인합니다.', priceText:'벽걸이 65,000원부터', serviceArea:'방림동과 인근 지역', availabilityText:'평일 오전 9시~오후 7시', icon:'🧼' },
  { id:'v5-4', kind:'service', name:'윤쌤 수학 교실', categorySlug:'lesson', categoryName:'과외·수업', relationType:'resident', summary:'초등·중등 소규모 수학 지도', description:'학생의 풀이 과정을 확인하는 소규모 수학 지도입니다.', priceText:'월 18만원부터', serviceArea:'방림동과 인근 지역', availabilityText:'상담 후 협의', icon:'📐' },
  { id:'v5-5', kind:'service', name:'라온 방문 헤어', categorySlug:'beauty-health', categoryName:'미용·건강', relationType:'resident', summary:'어르신 커트와 가정 방문 미용', description:'사전 예약으로 방문 미용을 제공합니다.', priceText:'커트 18,000원', serviceArea:'방림동과 인근 지역', availabilityText:'사전 예약', icon:'✂️' },
  { id:'v5-6', kind:'service', name:'이음 세무상담', categorySlug:'professional', categoryName:'세무·노무·문서지원', relationType:'resident', summary:'개인사업자 세금과 신고 상담', description:'사업자가 이해하기 쉬운 방식으로 기초 세무상담을 제공합니다.', priceText:'기초상담 30분', serviceArea:'온라인·방림동 인근', availabilityText:'예약 상담', icon:'🧾' },
  { id:'v5-7', kind:'service', name:'빛고을 사진관', categorySlug:'creative', categoryName:'디자인·개발·촬영', relationType:'neighbor', summary:'가족사진·행사·제품 촬영', description:'가족과 소규모 행사, 제품 촬영을 진행합니다.', priceText:'촬영 80,000원부터', serviceArea:'광주 지역', availabilityText:'예약제', icon:'📷' },
  { id:'v5-8', kind:'service', name:'포근한 반려돌봄', categorySlug:'pet', categoryName:'반려동물 돌봄', relationType:'neighbor', summary:'산책과 단기 방문 돌봄', description:'반려동물 산책과 짧은 방문 돌봄을 제공합니다.', priceText:'30분 15,000원', serviceArea:'방림동과 인근 지역', availabilityText:'예약제', icon:'🐕' },
  { id:'v5-9', kind:'service', name:'소담 수제공방', categorySlug:'handmade', categoryName:'농산물·수제품', relationType:'neighbor', summary:'천연비누와 소품 주문 제작', description:'수제품과 소규모 주문 제작을 진행합니다.', priceText:'제품 8,000원부터', serviceArea:'광주 지역', availabilityText:'주문 후 협의', icon:'🧶' },
  { id:'v5-10', kind:'shop', name:'마을카페 느린오후', categorySlug:'food', categoryName:'음식점·반찬·카페', relationType:'local', summary:'커피와 수제 디저트', description:'방림동 주민이 이용하는 동네 카페입니다.', priceText:'아메리카노 3,500원', serviceArea:'방림동', availabilityText:'영업시간 내', icon:'☕' },
  { id:'v5-11', kind:'service', name:'푸른들 농산물', categorySlug:'online', categoryName:'온라인 판매', relationType:'local', summary:'제철 채소와 과일 공동배송', description:'제철 농산물을 단지 공동배송으로 제공합니다.', priceText:'꾸러미 25,000원부터', serviceArea:'방림동 공동배송', availabilityText:'주 1회', icon:'🥬' },
  { id:'v5-12', kind:'service', name:'온마을 홈수리', categorySlug:'visit', categoryName:'방문 서비스', relationType:'local', summary:'수전·문고리·생활 소수리', description:'생활 속 소규모 수리 작업을 방문 제공합니다.', priceText:'기본 출장 25,000원', serviceArea:'방림동과 인근 지역', availabilityText:'예약제', icon:'🛠️' }
];

export const mockBenefits: Benefit[] = [
  { id:'benefit-1', businessId:'v5-1', businessName:'정다운 반찬가게', title:'첫 방문 10% 할인', description:'방림명지로드힐 인증 화면을 보여주세요.' },
  { id:'benefit-2', businessId:'v5-3', businessName:'온케어 에어컨 청소', title:'출장비 무료', description:'방림명지로드힐 세대 방문 시 적용됩니다.' },
  { id:'benefit-3', businessId:'v5-6', businessName:'이음 세무상담', title:'주민 첫 상담 무료', description:'30분 기초상담을 무료로 제공합니다.' },
  { id:'benefit-4', businessId:'v5-12', businessName:'온마을 홈수리', title:'두 가구 함께 신청 시 할인', description:'같은 날 두 세대가 신청하면 각 5,000원 할인합니다.' }
];

export const mockBusinesses: Business[] = rawBusinesses.map((business) => ({
  ...business,
  activeBenefit: mockBenefits.find((benefit) => benefit.businessId === business.id) ?? null
}));

export const mockPosts: ComplexPost[] = [
  { id:'post-1', sourceName:'입주자대표회의', category:'입대의 활동', title:'8월 입주자대표회의 활동 안내', body:'8월 입주자대표회의 활동 일정을 안내드립니다. 주민 생활에 필요한 주요 점검과 공용공간 관리사항을 확인하고 있습니다.', publishedAt:'2026-08-04T09:00:00+09:00' },
  { id:'post-2', sourceName:'관리사무소', category:'관리사무소 안내', title:'재활용 배출시간 안내', body:'재활용품은 화요일과 금요일 오후 6시부터 9시까지 배출해 주세요. 올바른 분리배출에 협조 부탁드립니다.', publishedAt:'2026-08-03T09:00:00+09:00' },
  { id:'post-3', sourceName:'단지온 운영자', category:'주민 사업자 소식', title:'주민 사업자 무료 등록 안내', body:'방림명지로드힐 주민이 운영하는 가게와 서비스를 단지온에 무료로 등록할 수 있습니다.', publishedAt:'2026-08-02T09:00:00+09:00' },
  { id:'post-4', sourceName:'관리사무소', category:'중요 안내', title:'8월 6일 101동 승강기 점검', body:'8월 6일 오전 10시부터 낮 12시까지 101동 승강기 정기점검을 실시합니다.', publishedAt:'2026-08-01T09:00:00+09:00' },
  { id:'post-5', sourceName:'단지온 운영자', category:'단지 행사', title:'주민 소규모 장터 참여 안내', body:'주민이 만든 수제품과 농산물, 생활서비스를 소개하는 소규모 장터 참여 신청을 받습니다.', publishedAt:'2026-07-30T09:00:00+09:00' }
];
