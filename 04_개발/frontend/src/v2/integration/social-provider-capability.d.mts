export type UiSocialProvider = 'kakao' | 'google';

export declare const UI_SOCIAL_PROVIDER_ORDER: readonly UiSocialProvider[];

export declare const AUTH_CAPABILITY_PATH: string;

export declare function normalizeUiSocialProviders(value: unknown): UiSocialProvider[];

export declare function socialProvidersFromCapabilityBody(body: unknown): UiSocialProvider[];
