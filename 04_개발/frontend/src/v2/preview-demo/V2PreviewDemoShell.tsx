import { useEffect, useState, type ReactNode } from 'react';
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

const TECHNICAL_MESSAGE_TRANSLATIONS: readonly [RegExp, string][] = [
  [/verified resident required/i, '입주민 인증 후 이용할 수 있습니다.'],
  [/authentication required|unauthorized|missing bearer/i, '로그인 후 이용할 수 있습니다.'],
  [/manager role required|admin role required/i, '운영자 권한이 필요한 기능입니다.'],
  [/forbidden/i, '현재 사용자 권한으로는 이용할 수 없습니다.'],
  [/business not found/i, '가게 정보를 찾을 수 없습니다.'],
  [/internal server error/i, '잠시 후 다시 이용해 주세요.']
];

function translateTechnicalMessage(text: string) {
  const match = TECHNICAL_MESSAGE_TRANSLATIONS.find(([pattern]) => pattern.test(text));
  return match?.[1] ?? text;
}

export default function V2PreviewDemoShell({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<PreviewDemoRole>(() => getPreviewDemoRole());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!PREVIEW_DEMO_ENABLED) return;

    const translateToasts = () => {
      document.querySelectorAll<HTMLElement>('.v2-integration-toast').forEach((toast) => {
        const current = toast.textContent?.trim() ?? '';
        const translated = translateTechnicalMessage(current);
        if (translated !== current) toast.textContent = translated;
      });
    };

    translateToasts();
    const observer = new MutationObserver(translateToasts);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  if (!PREVIEW_DEMO_ENABLED) return <>{children}</>;

  const actor = getPreviewDemoActor();

  function changeRole(nextRole: PreviewDemoRole) {
    if (nextRole === role) return;
    const previousRole = role;
    setPreviewDemoRole(nextRole);
    setRole(nextRole);

    if (previousRole === 'anonymous' || nextRole === 'anonymous') {
      window.location.reload();
    }
  }

  return (
    <div className="v2-preview-demo-shell" data-preview-demo-role={role}>
      <button
        type="button"
        className="v2-preview-demo-trigger"
        aria-expanded={open}
        aria-controls="v2-preview-demo-panel"
        onClick={() => setOpen((current) => !current)}
      >
        {open ? '권한표 닫기' : `권한 보기 · ${actor.label}`}
      </button>

      {open && (
        <aside id="v2-preview-demo-panel" className="v2-preview-demo-panel" aria-label="사용자 권한 비교">
          <div className="v2-preview-demo-heading">
            <span>사용자 권한 비교</span>
            <strong>역할을 바꾸며 실제 화면 차이를 확인하세요</strong>
          </div>
          <label>
            <span className="v2-preview-demo-sr-only">사용자 역할</span>
            <select
              aria-label="사용자 역할"
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
            <span><b>확인할 기능</b> · {actor.recommendedTest}</span>
          </div>

          <div className="v2-preview-demo-matrix-wrap">
            <div className="v2-preview-demo-matrix-title">
              <strong>권한 한눈에 보기</strong>
              <span><b>✓</b> 가능 · <b>—</b> 제한</span>
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
                          aria-label={`${item.label} · ${capability.label} · ${allowed ? '가능' : '제한'}`}
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
        </aside>
      )}
      {children}
    </div>
  );
}
