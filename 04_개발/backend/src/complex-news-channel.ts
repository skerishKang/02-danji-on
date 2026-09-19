import { NEWS_CHANNELS } from './core-v1';

export const SOURCE_CHANNEL = {
  '단지온 운영자': 'danjion_notice',
  '관리사무소': 'management_office'
} as const;

export type NewsChannel = (typeof NEWS_CHANNELS)[number];

// #768: the authoring authority of an official post is derived from its channel,
// not from an organisation name hardcoded in the UI. Clients mirror these exact
// keys; they must never infer the authority from a free-form source_name.
export const CHANNEL_AUTHORITY: Record<NewsChannel, string> = {
  danjion_notice: 'danjion_operator',
  apartment_news: 'resident_council',
  management_office: 'management_office',
  chair_greeting: 'resident_council_representative'
};

// Server-authoritative apartment-news presentation modes. 'highlight' keeps the
// existing lightweight popup; 'article' is the long-form board reader. The list
// must never guess the mode from title/body length in the browser.
export const NEWS_DISPLAY_MODES = ['highlight', 'article'] as const;
export type NewsDisplayMode = (typeof NEWS_DISPLAY_MODES)[number];

export function displayModeFor(value: unknown): NewsDisplayMode {
  const raw = value == null ? '' : String(value).trim();
  return (NEWS_DISPLAY_MODES as readonly string[]).includes(raw) ? (raw as NewsDisplayMode) : 'highlight';
}

export function authorityFor(channel: unknown): string {
  const raw = channel == null ? '' : String(channel).trim();
  return CHANNEL_AUTHORITY[raw as NewsChannel] ?? CHANNEL_AUTHORITY.apartment_news;
}

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
