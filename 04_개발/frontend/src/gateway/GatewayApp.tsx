import type { ReactNode } from 'react';
import './gateway.css';

type Surface = {
  id: 'v1' | 'v2';
  eyebrow: string;
  title: string;
  description: string;
  url: string | null;
};

function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;

  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function getVersionSurfaceUrl(target: 'v1' | 'v2' | 'gateway'): string | null {
  if (target === 'v1') return normalizeHttpUrl(import.meta.env.VITE_V1_URL);
  if (target === 'v2') return normalizeHttpUrl(import.meta.env.VITE_V2_URL);
  return normalizeHttpUrl(import.meta.env.VITE_GATEWAY_URL);
}

export function VersionSwitchLink({
  target,
  children
}: {
  target: 'v1' | 'v2' | 'gateway';
  children?: ReactNode;
}) {
  const url = getVersionSurfaceUrl(target);
  if (!url) return null;

  return (
    <a className="danjion-version-switch" href={url} data-version-target={target}>
      {children ?? `${target.toUpperCase()} 보기`}
    </a>
  );
}

export default function GatewayApp() {
  const surfaces: Surface[] = [
    {
      id: 'v1',
      eyebrow: 'CURRENT FUNCTIONAL BASELINE',
      title: '단지온 V1',
      description: '현재 React 제품 기준선입니다. 기존 기능·API 연결을 확인할 때 사용합니다.',
      url: getVersionSurfaceUrl('v1')
    },
    {
      id: 'v2',
      eyebrow: 'IMAGE-REFRESH UI',
      title: '단지온 V2',
      description: '새 이미지 리프레시 UI를 React로 옮기는 병렬 버전입니다. V1과 별도로 비교합니다.',
      url: getVersionSurfaceUrl('v2')
    }
  ];

  return (
    <main className="danjion-gateway-root" data-ui-variant="gateway">
      <section className="danjion-gateway-shell" aria-labelledby="gateway-title">
        <div className="danjion-gateway-brand">
          <span className="danjion-gateway-wordmark">단지온</span>
          <span className="danjion-gateway-complex">방림명지로드힐</span>
        </div>

        <div className="danjion-gateway-heading">
          <p className="danjion-gateway-kicker">VERSION GATEWAY</p>
          <h1 id="gateway-title">같은 단지온을<br />두 화면으로 비교합니다.</h1>
          <p>
            V1과 V2는 화면만 분리합니다. 백엔드·데이터·인증·저장 구조는 최종적으로 같은 제품 인프라를 사용합니다.
          </p>
        </div>

        <div className="danjion-gateway-grid" aria-label="단지온 버전 선택">
          {surfaces.map((surface) => (
            <article className={`danjion-gateway-card is-${surface.id}`} key={surface.id}>
              <div>
                <p className="danjion-gateway-card-eyebrow">{surface.eyebrow}</p>
                <h2>{surface.title}</h2>
                <p>{surface.description}</p>
              </div>

              {surface.url ? (
                <a className="danjion-gateway-enter" href={surface.url} data-version-target={surface.id}>
                  {surface.id.toUpperCase()} 들어가기
                  <span aria-hidden="true">↗</span>
                </a>
              ) : (
                <span className="danjion-gateway-unavailable" role="status">
                  Preview URL 미설정
                </span>
              )}
            </article>
          ))}
        </div>

        <p className="danjion-gateway-note">
          이 화면은 비교·검토용 Preview 게이트웨이입니다. Production 전환을 의미하지 않습니다.
        </p>
      </section>
    </main>
  );
}
