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

export function V2IntegrationPending() {
  return (
    <main
      data-ui-variant="v2"
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '32px',
        background: '#f7f2e8',
        color: '#171717',
        fontFamily:
          '"Pretendard Variable","Pretendard","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif'
      }}
    >
      <section style={{ maxWidth: '720px' }} aria-labelledby="v2-pending-title">
        <p style={{ margin: '0 0 12px', fontSize: '12px', fontWeight: 800, letterSpacing: '.1em' }}>
          DANJION V2
        </p>
        <h1
          id="v2-pending-title"
          style={{ margin: 0, fontSize: 'clamp(40px,7vw,72px)', lineHeight: 1.04, letterSpacing: '-.06em' }}
        >
          V2 화면 통합 대기 중
        </h1>
        <p style={{ margin: '22px 0 0', fontSize: '17px', lineHeight: 1.7, color: '#625e57' }}>
          버전 라우팅 계약은 준비됐지만 V2-A/V2-B 결과가 아직 통합되지 않았습니다. 이 문구가 보이는 상태를 V2 완성으로 간주하지 않습니다.
        </p>
      </section>
    </main>
  );
}
