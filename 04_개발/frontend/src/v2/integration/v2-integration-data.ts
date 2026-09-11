import type { BusinessApplicationInput, BusinessContact } from '../../types';
import { V2_REFERENCE_IMAGES, V2_SAMPLE_SHOPS, type V2ShopVisual } from '../visual';
import { V2_API_DATA_MODE } from './v2-live-data';

export const LOCAL_IMAGE_FALLBACK = '/field-demo/scenes-sprite.jpg';

export const adapterIdByVisualId: Record<string, string> = {
  'food-01': 'v5-1',
  'learning-preview': 'v5-4',
  'home-01': 'v5-3',
  'pro-01': 'v5-6',
  'craft-01': 'v5-9',
  'car-01': 'v5-2',
  'beauty-01': 'v5-5',
  'photo-01': 'v5-7'
};

export const learningPreview: V2ShopVisual = {
  id: 'learning-preview',
  name: '한결수학',
  category: 'learning',
  relation: 'resident',
  image: V2_REFERENCE_IMAGES.learning,
  desc: '중·고등학생에게 문제를 푸는 이유부터 설명하는 수학 과외입니다.',
  services: '중·고등 수학 · 개념 설명 · 문제 풀이',
  price: '중학생 월 32만원 · 고등학생 상담',
  area: '방림명지로드힐 생활권 · 방문/비대면 가능',
  benefit: '방림명지로드힐 학생 첫 수업 무료',
  availability: '평일 저녁 · 주말 상담',
  color: '#4057E8'
};

export const demoShops: V2ShopVisual[] = [
  V2_SAMPLE_SHOPS.find((shop) => shop.id === 'food-01')!,
  learningPreview,
  V2_SAMPLE_SHOPS.find((shop) => shop.id === 'home-01')!,
  V2_SAMPLE_SHOPS.find((shop) => shop.id === 'pro-01')!,
  ...V2_SAMPLE_SHOPS.filter((shop) => !['food-01', 'home-01', 'pro-01'].includes(shop.id))
].filter(Boolean);

export const emptyApplication: BusinessApplicationInput = {
  relationType: 'resident',
  businessName: '',
  categoryName: '과외·수업',
  serviceSummary: '',
  priceText: '',
  contactMethod: '',
  serviceArea: '',
  benefitText: '',
  availabilityText: '상담 후 협의'
};

export const OWNER_STEP_TITLES: Record<1 | 2 | 3 | 4, string> = {
  1: '주민 관계를 선택하세요',
  2: '기본 정보를 확인하세요',
  3: '사진과 주민혜택을 정하세요',
  4: '공개정보와 비공개 정보를 확인하세요'
};

export const RECOMMENDATION_STEP_TITLES: Record<1 | 2 | 3 | 4, string> = {
  1: '주민 관계를 선택하세요',
  2: '추천할 가게 정보를 알려주세요',
  3: '추천 범위를 확인하세요',
  4: '이웃가게 추천을 확인하세요'
};

export function matchesQuery(shop: V2ShopVisual, query: string) {
  if (!query.trim()) return true;
  const haystack = [shop.name, shop.desc, shop.services, shop.price, shop.area, shop.benefit].join(' ').toLowerCase();
  const compact = query.trim().toLowerCase().replace(/\s+/g, ' ');
  return compact.split(' ').every((token) => haystack.includes(token));
}

export function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function contactLabel(contact: BusinessContact) {
  return `${{ phone: '전화', sms: '문자', kakao: '카카오톡', url: '온라인' }[contact.type]} · ${contact.value}`;
}

export function adapterIdForShop(shopId: string) {
  return V2_API_DATA_MODE ? shopId : (adapterIdByVisualId[shopId] ?? shopId);
}
