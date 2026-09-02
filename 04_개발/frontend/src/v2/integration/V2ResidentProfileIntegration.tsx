import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { residentMessagesClient } from '../../resident-messages-client';
import { residentProfileClient, type ResidentPublicProfile } from '../../resident-profile-client';
import { residentSafetyClient, type ResidentReportReason } from '../../resident-safety-client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPORT_OPTIONS: Array<{ value: ResidentReportReason; label: string }> = [
  { value: 'abuse', label: '욕설·괴롭힘' },
  { value: 'threat', label: '위협' },
  { value: 'privacy', label: '개인정보 침해' },
  { value: 'defamation_risk', label: '명예훼손 우려' },
  { value: 'spam', label: '스팸' },
  { value: 'other', label: '기타' }
];

function canonicalUserId(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return UUID_RE.test(text) ? text : null;
}

function openConversation(conversationId: string) {
  window.dispatchEvent(new CustomEvent('danjion:v2-open-conversation', { detail: { conversationId } }));
}

export default function V2ResidentProfileIntegration() {
  const [profileTarget, setProfileTarget] = useState<HTMLElement | null>(null);
  const [selfProfile, setSelfProfile] = useState<ResidentPublicProfile | null>(null);
  const [nickname, setNickname] = useState('');
  const [publicBio, setPublicBio] = useState('');
  const [otherProfile, setOtherProfile] = useState<ResidentPublicProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [selfStatus, setSelfStatus] = useState('');
  const [otherStatus, setOtherStatus] = useState('');
  const [reportReason, setReportReason] = useState<ResidentReportReason>('abuse');
  const [reportDetail, setReportDetail] = useState('');

  useEffect(() => {
    const sync = () => {
      const next = document.querySelector<HTMLElement>('.v2-profile-dialog');
      setProfileTarget((current) => current === next ? current : next);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!profileTarget) return;
    let cancelled = false;
    setSelfStatus('공개프로필을 불러오는 중입니다.');
    void residentProfileClient.getSelf()
      .then((profile) => {
        if (cancelled) return;
        setSelfProfile(profile);
        setNickname(profile.nickname);
        setPublicBio(profile.publicBio);
        setSelfStatus('');
      })
      .catch(() => {
        if (!cancelled) setSelfStatus('공개프로필을 불러오지 못했습니다.');
      });
    return () => { cancelled = true; };
  }, [profileTarget]);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const userId = canonicalUserId((event as CustomEvent<{ userId?: unknown }>).detail?.userId);
      if (!userId) return;
      setBusy(true);
      setOtherStatus('주민 프로필을 불러오는 중입니다.');
      setReportReason('abuse');
      setReportDetail('');
      void residentProfileClient.getResident(userId)
        .then((profile) => {
          setOtherProfile(profile);
          setOtherStatus('');
        })
        .catch((error) => {
          setOtherProfile(null);
          setOtherStatus(error instanceof Error ? error.message : '주민 프로필을 볼 수 없습니다.');
        })
        .finally(() => setBusy(false));
    };
    window.addEventListener('danjion:v2-open-resident-profile', onOpen);
    return () => window.removeEventListener('danjion:v2-open-resident-profile', onOpen);
  }, []);

  async function saveSelf(event: FormEvent) {
    event.preventDefault();
    if (!selfProfile || busy) return;
    const nextNickname = nickname.trim();
    const nextBio = publicBio.trim();
    if (!nextNickname || nextNickname.length > 40 || nextBio.length > 300) {
      setSelfStatus('닉네임은 1~40자, 소개는 최대 300자로 입력해 주세요.');
      return;
    }
    setBusy(true);
    setSelfStatus('공개프로필을 저장하는 중입니다.');
    try {
      const profile = await residentProfileClient.updateSelf({ nickname: nextNickname, publicBio: nextBio });
      setSelfProfile(profile);
      setNickname(profile.nickname);
      setPublicBio(profile.publicBio);
      setSelfStatus('공개프로필을 저장했습니다.');
    } catch (error) {
      setSelfStatus(error instanceof Error ? error.message : '공개프로필을 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function messageResident() {
    if (!otherProfile || busy) return;
    setBusy(true);
    setOtherStatus('대화를 여는 중입니다.');
    try {
      const conversation = await residentMessagesClient.startConversation(otherProfile.userId);
      setOtherProfile(null);
      setOtherStatus('');
      openConversation(conversation.id);
    } catch (error) {
      setOtherStatus(error instanceof Error ? error.message : '대화를 시작할 수 없습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function blockResident() {
    if (!otherProfile || busy) return;
    setBusy(true);
    setOtherStatus('차단하는 중입니다.');
    try {
      const userId = otherProfile.userId;
      await residentSafetyClient.blockResident(userId);
      setOtherProfile(null);
      setOtherStatus('해당 주민을 차단했습니다. 메시지와 프로필 접근도 서버 정책에 따라 제한됩니다.');
      window.dispatchEvent(new CustomEvent('danjion:v2-resident-blocked', { detail: { userId } }));
    } catch (error) {
      setOtherStatus(error instanceof Error ? error.message : '차단하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function reportResident(event: FormEvent) {
    event.preventDefault();
    if (!otherProfile || busy) return;
    if (reportDetail.trim().length > 1000) {
      setOtherStatus('신고 설명은 최대 1000자로 입력해 주세요.');
      return;
    }
    setBusy(true);
    setOtherStatus('신고를 접수하는 중입니다.');
    try {
      const result = await residentSafetyClient.reportResident(otherProfile.userId, reportReason, reportDetail);
      setOtherStatus(result === 'already_reported' ? '이미 검토 중인 신고가 있습니다.' : '신고가 접수되었습니다.');
      setReportDetail('');
    } catch (error) {
      setOtherStatus(error instanceof Error ? error.message : '신고를 접수하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  const selfPanel = profileTarget ? createPortal(
    <section className="v2-profile-benefits" data-v2-self-profile-panel aria-labelledby="v2-self-profile-title">
      <h3 id="v2-self-profile-title">공개프로필</h3>
      {!selfProfile && <p>{selfStatus || '공개프로필을 불러오는 중입니다.'}</p>}
      {selfProfile && (
        <form onSubmit={(event) => void saveSelf(event)}>
          <label>
            닉네임
            <input value={nickname} maxLength={40} disabled={busy} onChange={(event) => setNickname(event.target.value)} />
          </label>
          <label>
            공개 소개
            <textarea value={publicBio} maxLength={300} rows={3} disabled={busy} onChange={(event) => setPublicBio(event.target.value)} />
          </label>
          <p>인증 주민 · 가입 {selfProfile.joinedMonth} · 공개 활동 {selfProfile.publicActivityCount}개</p>
          <button type="submit" className="v2-btn v2-btn-small" disabled={busy}>프로필 저장</button>
        </form>
      )}
      {selfStatus && <p role="status" data-v2-self-profile-status>{selfStatus}</p>}
    </section>,
    profileTarget
  ) : null;

  const otherDialog = otherProfile ? createPortal(
    <div className="v2-dialog-backdrop" data-v2-resident-profile-backdrop onMouseDown={(event) => { if (event.target === event.currentTarget) setOtherProfile(null); }}>
      <section className="v2-dialog" role="dialog" aria-modal="true" aria-labelledby="v2-resident-profile-title" data-v2-resident-profile-dialog>
        <button type="button" className="v2-dialog-close" onClick={() => setOtherProfile(null)}>닫기</button>
        <span className="v2-eyebrow">VERIFIED RESIDENT</span>
        <h2 id="v2-resident-profile-title">{otherProfile.nickname}</h2>
        <p>{otherProfile.publicBio || '공개 소개가 없습니다.'}</p>
        <p>인증 주민 · 가입 {otherProfile.joinedMonth} · 공개 활동 {otherProfile.publicActivityCount}개</p>
        <div className="v2-dialog-actions">
          <button type="button" className="v2-btn v2-btn-primary" disabled={busy} onClick={() => void messageResident()}>메시지 보내기</button>
          <button type="button" className="v2-btn" disabled={busy} onClick={() => void blockResident()}>차단</button>
        </div>
        <form onSubmit={(event) => void reportResident(event)} data-v2-resident-report-form>
          <label>
            신고 사유
            <select value={reportReason} disabled={busy} onChange={(event) => setReportReason(event.target.value as ResidentReportReason)}>
              {REPORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            설명(선택)
            <textarea value={reportDetail} maxLength={1000} rows={3} disabled={busy} onChange={(event) => setReportDetail(event.target.value)} />
          </label>
          <button type="submit" className="v2-btn v2-btn-small" disabled={busy}>신고 접수</button>
        </form>
        {otherStatus && <p role="status" data-v2-resident-profile-status>{otherStatus}</p>}
      </section>
    </div>,
    document.body
  ) : null;

  const detachedStatus = !otherProfile && otherStatus ? createPortal(
    <p className="v2-integration-toast" role="status" data-v2-resident-profile-detached-status>{otherStatus}</p>,
    document.body
  ) : null;

  return <>{selfPanel}{otherDialog}{detachedStatus}</>;
}
