import type { ReactNode } from 'react';

export type DanjiOnUiVariant = 'v1' | 'v2' | 'gateway';

export function getDanjiOnUiVariant(raw: unknown = import.meta.env.VITE_UI_VARIANT): DanjiOnUiVariant {
  if (typeof raw !== 'string') return 'v1';

  const normalized = raw.trim().toLowerCase();
  if (normalized === 'v2' || normalized === 'gateway') return normalized;
  return 'v1';
}

export function UiVariantRoot({
  variant,
  v1,
  v2,
  gateway
}: {
  variant: DanjiOnUiVariant;
  v1: ReactNode;
  v2: ReactNode;
  gateway: ReactNode;
}) {
  if (variant === 'gateway') return gateway;
  if (variant === 'v2') return v2;
  return v1;
}
