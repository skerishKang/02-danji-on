import { NEWS_CHANNELS } from './core-v1';

export const SOURCE_CHANNEL = {
  '단지온 운영자': 'danjion_notice',
  '관리사무소': 'management_office'
} as const;

export type NewsChannel = (typeof NEWS_CHANNELS)[number];

const DEFAULT_CHANNEL = 'apartment_news';

export function deriveChannel(sourceName: string, explicit?: unknown): NewsChannel | null {
  if (explicit !== undefined && explicit !== null && String(explicit).trim() !== '') {
    const value = String(explicit).trim();
    if (!NEWS_CHANNELS.includes(value)) return null;
    return value as NewsChannel;
  }
  const trimmed = sourceName.trim();
  return (SOURCE_CHANNEL[trimmed as keyof typeof SOURCE_CHANNEL] ?? DEFAULT_CHANNEL) as NewsChannel;
}
