import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  DANJION_ACCOUNT_CLOSE_CONFIRMATION,
  residentAccountLifecycleClient,
  type DanjiOnAccountCloseResult
} from '../../resident-account-lifecycle-client';

export default function V2AccountClosurePortal() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<DanjiOnAccountCloseResult | null>(null);

  useEffect(() => {
    const sync = () => {
      const next = document.querySelector<HTMLElement>('.v2-profile-dialog');
      setTarget((current) => current === next ? current : next);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  async function closeAccount(event: FormEvent) {
    event.preventDefault();
    if (busy || confirmation.trim() !== DANJION_ACCOUNT_CLOSE_CONFIRMATION) return;
    setBusy(true);
    setStatus('단지온 계정을 종료하는 중입니다.');
    try {
      const closed = await residentAccountLifecycleClient.closeProductAccount(confirmation);
      setResult(closed);
      setConfirmation('');
      setStatus('단지온 제품 계정을 종료했습니다.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '단지온 계정을 종료하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  if (!target) return null;

  return createPortal(
    <section className="v2-profile-benefits" data-v2-account-closure-panel aria-labelledby="v2-account-closure-title">
      <div className="v2-profile-section-heading">
        <h3 id="v2-account-closure-title">계정 종료</h3>
      </div>
      {result ? (
        <div data-v2-account-closure-complete>
          <strong>단지온 계정 종료 완료</strong>
          <p>단지온 제품 계정과 연결된 주민·세대·운영 권한은 서버 정책에 따라 회수되었습니다.</p>
          <p>외부 로그인 제공자 계정은 삭제하지 않습니다.</p>
          <small>{result.closedAt ? `종료 시각 ${new Date(result.closedAt).toLocaleString('ko-KR')}` : '종료 처리 완료'}</small>
        </div>
      ) : (
        <form onSubmit={(event) => void closeAccount(event)} data-v2-account-closure-form>
          <p>이 작업은 단지온 제품 계정을 종료하고 현재 주민·세대·운영 권한을 회수합니다. 게시물·댓글의 보존 정책은 별도 운영정책을 따릅니다.</p>
          <p><strong>외부 로그인 제공자 계정 자체는 삭제하지 않습니다.</strong></p>
          <label>
            계정 종료 확인 문구
            <input
              value={confirmation}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={DANJION_ACCOUNT_CLOSE_CONFIRMATION}
            />
          </label>
          <small>계속하려면 <code>{DANJION_ACCOUNT_CLOSE_CONFIRMATION}</code> 을(를) 정확히 입력하세요.</small>
          <button
            type="submit"
            className="v2-btn v2-btn-small"
            disabled={busy || confirmation.trim() !== DANJION_ACCOUNT_CLOSE_CONFIRMATION}
          >
            {busy ? '종료 중…' : '단지온 계정 종료'}
          </button>
        </form>
      )}
      {status && <p role="status" data-v2-account-closure-status>{status}</p>}
    </section>,
    target
  );
}
