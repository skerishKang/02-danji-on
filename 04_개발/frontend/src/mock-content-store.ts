import type { Benefit, ComplexPost } from './types';

const POSTS_KEY = 'danjion.mock.posts.v1';
const BENEFITS_KEY = 'danjion.mock.benefits.v1';

function readArray<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function writeArray<T>(key: string, values: T[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(values));
}

export function listStoredMockPosts(): ComplexPost[] {
  return readArray<ComplexPost>(POSTS_KEY);
}

export function createStoredMockPost(input: { sourceName: string; category: string; title: string; body: string }): ComplexPost {
  const post: ComplexPost = {
    id: `mock-post-${crypto.randomUUID()}`,
    sourceName: input.sourceName,
    category: input.category,
    channel: 'apartment_news',
    title: input.title,
    body: input.body,
    publishedAt: new Date().toISOString()
  };
  writeArray(POSTS_KEY, [post, ...listStoredMockPosts()]);
  return post;
}

export function listStoredMockBenefits(): Benefit[] {
  return readArray<Benefit>(BENEFITS_KEY);
}

export function createStoredMockBenefit(input: {
  businessId: string;
  businessName: string;
  title: string;
  description: string;
  conditions?: string;
}): Benefit {
  const benefit: Benefit = {
    id: `mock-benefit-${crypto.randomUUID()}`,
    businessId: input.businessId,
    businessName: input.businessName,
    title: input.title,
    description: input.description,
    conditions: input.conditions || null
  };
  writeArray(BENEFITS_KEY, [benefit, ...listStoredMockBenefits()]);
  return benefit;
}

export function resetMockContent() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(POSTS_KEY);
  window.localStorage.removeItem(BENEFITS_KEY);
}
