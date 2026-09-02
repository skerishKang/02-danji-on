import { useEffect, useState } from 'react';
import { residentSettingsClient, type ResidentConsentPreference, type ResidentSettings } from '../../resident-settings-client';

function consentState(preference: ResidentConsentPreference): string {
  if (preference.enabled === true) return '수신 중';
  if (preference.enabled === false) return '수신 안 함';
  return '설정 기록 없음';
}

function policyText(preference: ResidentConsentPreference): string {
  return preference.policyVersion ? `기록 정책 ${preference.policyVersion}` : '정책 버전 연결 전';
}

export default function V2SettingsPanel() {
  const [settings, setSettings] = useState<ResidentSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let cancelled = false;
    setStatus('이용 설정을 불러오는 중입니다.');
    void residentSettingsClient.get()
      .then((value) => {
        if (cancelled) return;
        setSettings(value);
        setStatus('');
      })
      .catch(() => {
        if (!cancelled) setStatus('이용 설정을 불러오지 못했습니다.');
      });
    return () => { cancelled = true; };
  }, []);

  async function togglePublicProfile() {
    if (!settings || busy) return;
    setBusy(true);
    setStatus('공개프로필 설정을 저장하는 중입니다.');
    try {
      const next = await residentSettingsClient.setPublicProfileEnabled(!settings.publicProfileEnabled);
      setSettings(next);
      setStatus(next.publicProfileEnabled ? '공개프로필을 다시 공개했습니다.' : '공개프로필을 다른 주민에게 숨겼습니다.');
    } catch {
      setStatus('공개프로필 설정을 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="v2-profile-benefits" data-v2-settings-panel aria-labelledby="v2-settings-title">
      <h3 id="v2-settings-title">이용 설정</h3>
      {!settings && <p>{status || '이용 설정을 불러오는 중입니다.'}</p>}
      {settings && (
        <>
          <article data-v2-public-profile-setting>
            <div>
              <strong>공개프로필</strong>
              <span>{settings.publicProfileEnabled ? '다른 인증 주민에게 공개 중' : '다른 주민에게 비공개'}</span>
            </div>
            <div>
              <button
                type="button"
                className="v2-btn v2-btn-small"
                aria-pressed={settings.publicProfileEnabled}
                disabled={busy}
                onClick={() => void togglePublicProfile()}
              >
                {settings.publicProfileEnabled ? '공개프로필 숨기기' : '공개프로필 다시 공개'}
              </button>
            </div>
          </article>

          <article data-v2-notification-settings>
            <div>
              <strong>서비스 알림</strong>
              <span>{consentState(settings.serviceNotifications)} · {policyText(settings.serviceNotifications)}</span>
            </div>
            <div><b>약관 동의 기록</b></div>
          </article>

          <article data-v2-benefit-marketing-setting>
            <div>
              <strong>혜택·이벤트 알림</strong>
              <span>{consentState(settings.benefitMarketing)} · {policyText(settings.benefitMarketing)}</span>
            </div>
            <div><b>약관 동의 기록</b></div>
          </article>

          <p className="v2-data-notice">
            알림 수신 변경은 현재 정책 버전이 확인되는 약관 동의 화면에서 처리합니다. 이 화면에서 임의의 정책 버전을 만들지 않습니다.
          </p>
          <p className="v2-data-notice">글자크기는 현재 이 기기의 접근성 설정을 따릅니다.</p>
          {status && <p role="status" data-v2-settings-status>{status}</p>}
        </>
      )}
    </section>
  );
}
