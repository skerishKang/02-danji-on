import { storageAdapter } from '../../storage';
import type { Business, BusinessApplication, BusinessApplicationInput } from '../../types';
import {
  V2_REFERENCE_IMAGES,
  type V2CategoryKey,
  type V2ReferenceImage,
  type V2RelationKey,
  type V2ShopVisual
} from '../visual';

export const V2_API_DATA_MODE = import.meta.env.VITE_DATA_MODE === 'api';
export const V2_DEMO_OPERATOR_MODE = !V2_API_DATA_MODE;

export function relationToV2Visual(value: Business['relationType']): V2RelationKey {
  if (value === 'resident') return 'resident';
  if (value === 'resident_family') return 'family';
  if (value === 'neighbor') return 'neighbor';
  return 'partner';
}

export function categoryForV2Text(categoryName = '', summary = '', categorySlug = ''): V2CategoryKey {
  const text = `${categorySlug} ${categoryName} ${summary}`.toLowerCase();
  if (/수학|과외|수업|교육|학원|learning|education/.test(text)) return 'learning';
  if (/반찬|음식|카페|요리|식품|food|cafe/.test(text)) return 'food';
  if (/청소|수리|에어컨|정비|자동차|home|repair|clean/.test(text)) return 'home';
  if (/세무|노무|상담|문서|법무|professional|consult/.test(text)) return 'professional';
  if (/미용|헤어|뷰티|beauty|hair/.test(text)) return 'beauty';
  return 'creative';
}

export function categoryForApplication(input: BusinessApplicationInput): V2CategoryKey {
  return categoryForV2Text(input.categoryName, input.serviceSummary);
}

export function imageForV2Category(category: V2CategoryKey): V2ReferenceImage {
  if (category === 'learning') return V2_REFERENCE_IMAGES.learning;
  if (category === 'food') return V2_REFERENCE_IMAGES.food;
  if (category === 'home') return V2_REFERENCE_IMAGES.home;
  if (category === 'professional') return V2_REFERENCE_IMAGES.professional;
  if (category === 'beauty') return V2_REFERENCE_IMAGES.beauty;
  return V2_REFERENCE_IMAGES.photo;
}

function categoryColor(category: V2CategoryKey) {
  if (category === 'learning') return '#4057E8';
  if (category === 'food') return '#E95C3E';
  if (category === 'home') return '#BDE53E';
  if (category === 'professional') return '#6840A5';
  if (category === 'beauty') return '#A65B73';
  return '#C56A45';
}

async function imageForBusiness(business: Business, category: V2CategoryKey): Promise<V2ReferenceImage> {
  const fallback = imageForV2Category(category);
  const objectKey = business.representativeImageObjectKey;
  if (!objectKey || !storageAdapter.resolvePreview) return fallback;

  try {
    const src = await storageAdapter.resolvePreview(objectKey);
    if (!src) return fallback;
    return {
      ...fallback,
      src,
      alt: `${business.name} 대표 이미지`
    };
  } catch {
    return fallback;
  }
}

export async function businessToV2Visual(business: Business): Promise<V2ShopVisual> {
  const category = categoryForV2Text(business.categoryName, business.summary, business.categorySlug);
  return {
    id: business.id,
    name: business.name,
    category,
    relation: relationToV2Visual(business.relationType),
    image: await imageForBusiness(business, category),
    desc: business.summary || business.description,
    services: business.description || business.summary,
    price: business.priceText || '상담 후 안내',
    area: business.serviceArea || '방림동과 인근 지역',
    benefit: business.activeBenefit?.title || '등록된 주민혜택 없음',
    availability: business.availabilityText || '상담 후 협의',
    color: categoryColor(category)
  };
}

export async function approvedBusinessToV2Visual(
  business: Business,
  application: BusinessApplication
): Promise<V2ShopVisual> {
  const base = await businessToV2Visual(business);
  const category = categoryForApplication({
    relationType: application.relationType,
    businessName: application.businessName,
    categoryName: application.categoryName,
    serviceSummary: application.serviceSummary,
    priceText: application.priceText,
    contactMethod: application.contactMethod,
    serviceArea: application.serviceArea,
    benefitText: application.benefitText,
    availabilityText: application.availabilityText,
    representativeImageObjectKey: application.representativeImageObjectKey
  });
  return {
    ...base,
    category,
    relation: relationToV2Visual(business.relationType),
    desc: business.summary || application.serviceSummary,
    services: application.serviceSummary,
    price: business.priceText || application.priceText || '상담 후 안내',
    area: business.serviceArea || application.serviceArea || '방림동과 인근 지역',
    benefit: business.activeBenefit?.title || application.benefitText || '등록된 주민혜택 없음',
    availability: business.availabilityText || application.availabilityText || '상담 후 협의',
    color: categoryColor(category)
  };
}
