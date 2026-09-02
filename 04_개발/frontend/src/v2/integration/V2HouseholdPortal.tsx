import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { householdFamilyClient, type HouseholdInviteCreated, type HouseholdSnapshot } from '../../household-family-client';

function shortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function V2HouseholdPortal() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [snapshot, setSnapshot] = useState<HouseholdSnapshot | null>(null);
  const [latestInvite, setLatestInvite] = useState<HouseholdInviteCreated | null>(null);
  const [redeemToken, setRedeemToken] = useState('');
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

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

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setSnapshot(await householdFamilyClient.getSnapshot());
      setStatus('');
    } catch {
      setSnapshot(null);
      setStatus('현재 연결된 세대 정보를 확인할 수 없습니다. 가족 초대 토큰이 있다면 아래에서 수락할 수 있습니다.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (target) void refresh();
  }, [target, refresh]);

  async function createInvite() {
    if (busy) return;
    setBusy(true);
    try {
      const invite = await householdFamilyClient.createInvite(24);
      setLatestInvite(invite);
      setSnapshot(await householdFamilyClient.getSnapshot());
      setStatus('가족 초대를 만들었습니다. 초대 토큰은 이 화면에서만 전달하고 브라우저에 저장하지 않습니다.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '가족 초대를 만들지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function revokeInvite(inviteId: string) {
    if (busy) return;
    setBusy(true);
    try {
      await householdFamilyClient.revokeInvite(inviteId);
      setSnapshot(await householdFamilyClient.getSnapshot());
      if (latestInvite?.inviteId === inviteId) setLatestInvite(null);
      setStatus('가족 초대를 회수했습니다.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '가족 초대를 회수하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function redeem(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result = await householdFamilyClient.redeemInvite(redeemToken);
      setRedeemToken('');
      await refresh();
      setStatus(result.verificationRequired
        ? '가족 초대를 수락했습니다. 세대원 상태는 확인 대기이며 주민 권한은 아직 부여되지 않습니다.'
        : '가족 초대를 수락했습니다.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '가족 초대를 수락하지 못했습니다.');
      setBusy(false);
    }
  }

  async function revokeMember(membershipId: string) {
    if (confirmRemoveId !== membershipId) {
      setConfirmRemoveId(membershipId);
      return;
    }
    setBusy(true);
    try {
      await householdFamilyClient.revokeMember(membershipId);
      setConfirmRemoveId(null);
      setSnapshot(await householdFamilyClient.getSnapshot());
      setStatus('세대원 연결을 해제했습니다.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '세대원 연결을 해제하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function leaveHousehold() {
    if (!confirmLeave) {
      setConfirmLeave(true);
      return;
    }
    setBusy(true);
    try {
      await householdFamilyClient.leave();
      setConfirmLeave(false);
      setSnapshot(null);
      setStatus('세대 연결을 해제했습니다. 주민 권한도 서버 정책에 따라 회수됩니다.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '세대 연결을 해제하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  const primary = snapshot?.myMembership.membershipRole === 'primary' && snapshot.myMembership.status === 'verified';

  return target ? createPortal(
    <section className="v2-profile-benefits" data-v2-household-panel aria-labelledby="v2-household-title">
      <div className="v2-profile-section-heading">
        <h3 id="v2-household-title">세대·가족</h3>
        <button type="button" className="v2-btn v2-btn-small" disabled={busy} onClick={() => void refresh()}>새로고침</button>
      </div>

      {snapshot && (
        <div data-v2-household-members>
          <p>세대 구성원 {snapshot.members.length}명</p>
          {snapshot.members.map((member) => (
            <article key={member.membershipId} data-v2-household-member>
              <div>
                <strong>{member.displayName}</strong>
                <span>{member.membershipRole === 'primary' ? '주 세대원' : '세대원'} · {member.residentVerified ? '주민 확인됨' : '확인 대기'}</span>
              </div>
              {primary && member.membershipRole !== 'primary' && (
                <button type="button" className="v2-btn v2-btn-small" disabled={busy} onClick={() => void revokeMember(member.membershipId)}>
                  {confirmRemoveId === member.membershipId ? '정말 해제' : '세대원 해제'}
                </button>
              )}
            </article>
          ))}

          {primary && (
            <div>
              <button type="button" className="v2-btn v2-btn-small" disabled={busy} onClick={() => void createInvite()}>가족 초대 만들기</button>
              {latestInvite && (
                <div data-v2-household-one-time-token>
                  <strong>한 번만 표시되는 가족 초대 토큰</strong>
                  <textarea readOnly rows={2} value={latestInvite.token} aria-label="가족 초대 토큰" />
                  <small>만료 {shortDate(latestInvite.expiresAt)} · 브라우저 저장 안 함</small>
                </div>
              )}
              {snapshot.invites.map((invite) => (
                <article key={invite.inviteId} data-v2-household-invite>
                  <span>{invite.status} · 만료 {shortDate(invite.expiresAt)}</span>
                  {invite.status === 'pending' && <button type="button" className="v2-btn v2-btn-small" disabled={busy} onClick={() => void revokeInvite(invite.inviteId)}>초대 회수</button>}
                </article>
              ))}
            </div>
          )}

          {!primary && snapshot.myMembership.membershipRole !== 'primary' && (
            <button type="button" className="v2-btn v2-btn-small" disabled={busy} onClick={() => void leaveHousehold()}>
              {confirmLeave ? '정말 세대 연결 해제' : '세대 연결 해제'}
            </button>
          )}
        </div>
      )}

      <form onSubmit={(event) => void redeem(event)} data-v2-household-redeem-form>
        <label>
          가족 초대 토큰 수락
          <textarea rows={2} value={redeemToken} disabled={busy} onChange={(event) => setRedeemToken(event.target.value)} />
        </label>
        <p>초대를 수락해도 확인 절차가 끝나기 전에는 주민 권한이 부여되지 않습니다.</p>
        <button type="submit" className="v2-btn v2-btn-small" disabled={busy || !redeemToken.trim()}>초대 수락</button>
      </form>

      {status && <p role="status" data-v2-household-status>{status}</p>}
    </section>,
    target
  ) : null;
}
