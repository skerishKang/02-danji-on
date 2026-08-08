import { useState, type ReactNode } from 'react';
import {
  getPreviewDemoActor,
  getPreviewDemoRole,
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
    setPreviewDemoRole(nextRole);
    setRole(nextRole);
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
        <p>{actor.description}</p>
        <small>실제 로그인을 대신하는 비운영 Preview 전용 기능입니다. Production 빌드에는 표시되지 않습니다.</small>
      </aside>
      {children}
    </div>
  );
}
