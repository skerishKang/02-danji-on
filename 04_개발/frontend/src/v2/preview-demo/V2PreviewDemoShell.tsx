import { useState, type ReactNode } from 'react';
import {
  getPreviewDemoActor,
  getPreviewDemoRole,
  PREVIEW_DEMO_CAPABILITIES,
  PREVIEW_DEMO_ENABLED,
  PREVIEW_DEMO_ROLES,
  setPreviewDemoRole,
  type PreviewDemoRole
} from '../../preview-demo';
import './v2-preview-demo.css';

export default function V2PreviewDemoShell({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<PreviewDemoRole>(() => getPreviewDemoRole());

  if (!PREVIEW_DEMO_ENABLED) return <>{children}</>;

  const actor = getPreviewDemoActor();

  function changeRole(nextRole: PreviewDemoRole) {
    if (nextRole === role) return;
    const previousRole = role;
    setPreviewDemoRole(nextRole);
    setRole(nextRole);

    // Anonymous has a different authenticated/readiness boundary. Reload only when
    // entering or leaving anonymous so private data is initialized/cleared correctly.
    // Authenticated synthetic roles switch in-place: request headers are resolved at
    // call time, so resident -> manager preserves the active application/promo state
    // needed to validate the complete submit -> review -> approve -> rediscover loop.
    if (previousRole === 'anonymous' || nextRole === 'anonymous') {
      window.location.reload();
    }
  }

  return (
    <div className="v2-preview-demo-shell" data-preview-demo-role={role}>
      <aside className="v2-preview-demo-panel" aria-label="V2 시연 역할 전환">
        <div className="v2-preview-demo-heading">
          <span>PREVIEW ONLY</span>
          <strong>시연 역할 · 실제 테스트 DB</strong>
        </div>
        <label>
          <span className="v2-preview-demo-sr-only">시연 역할</span>
          <select
            aria-label="시연 역할"
            value={role}
            onChange={(event) => changeRole(event.target.value as PreviewDemoRole)}
          >
            {PREVIEW_DEMO_ROLES.map((item) => (
              <option key={item.role} value={item.role}>{item.label}</option>
            ))}
          </select>
        </label>

        <div className="v2-preview-demo-current" aria-live="polite">
          <strong>{actor.label}</strong>
          <p>{actor.description}</p>
          <span><b>추천 테스트</b> · {actor.recommendedTest}</span>
        </div>

        <div className="v2-preview-demo-matrix-wrap">
          <div className="v2-preview-demo-matrix-title">
            <strong>권한 한눈에 보기</strong>
            <span><b>✓</b> 가능 · <b>—</b> 차단</span>
          </div>
          <table className="v2-preview-demo-matrix">
            <thead>
              <tr>
                <th scope="col">기능</th>
                {PREVIEW_DEMO_ROLES.map((item) => (
                  <th
                    key={item.role}
                    scope="col"
                    className={item.role === role ? 'is-current' : undefined}
                    aria-current={item.role === role ? 'true' : undefined}
                  >
                    {item.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PREVIEW_DEMO_CAPABILITIES.map((capability) => (
                <tr key={capability.key}>
                  <th scope="row" title={capability.label}>{capability.shortLabel}</th>
                  {PREVIEW_DEMO_ROLES.map((item) => {
                    const allowed = item.permissions[capability.key];
                    return (
                      <td
                        key={item.role}
                        className={`${allowed ? 'is-allowed' : 'is-denied'}${item.role === role ? ' is-current' : ''}`}
                        aria-label={`${item.label} · ${capability.label} · ${allowed ? '가능' : '차단'}`}
                      >
                        <span aria-hidden="true">{allowed ? '✓' : '—'}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <small>이 표는 현재 Preview 테스트 계정과 서버 권한 계약 기준입니다. 실제 로그인을 대신하는 비운영 기능이며 Production 빌드에는 표시되지 않습니다.</small>
      </aside>
      {children}
    </div>
  );
}
