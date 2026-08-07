import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { residentVerificationAdapter } from './verification-api';
import { storageAdapter, type StoredObject } from './storage';
import type { ResidentVerificationInput, ResidentVerificationMethod, ResidentVerificationState } from './verification-types';

const statusLabels: Record<ResidentVerificationState['status'], string> = {
  unverified: '미인증',
  pending: '확인 대기',
  verified: '인증 완료',
  rejected: '반려'
};

export default function ResidentVerificationApp() {
  const [state, setState] = useState<ResidentVerificationState | null>(null);
  const [form, setForm] = useState<ResidentVerificationInput>({ building: '', unit: '', method: 'management_confirmation', evidenceObjectKey: null });
  const [evidence, setEvidence] = useState<StoredObject | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    try {
      const next = await residentVerificationAdapter.get();
      setState(next);
      setForm({
        building: next.building || '',
        unit: next.unit || '',
        method: next.method || 'management_confirmation',
        evidenceObjectKey: next.evidenceObjectKey || null
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '입주민 인증 상태를 불러오지 못했습니다.');
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => () => { if (evidence) storageAdapter.releasePreview?.(evidence); }, [evidence]);

  async function chooseEvidence(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setMessage('');
    try {
      const uploaded = await storageAdapter.upload('resident-evidence', file);
      setEvidence(uploaded);
      setForm((current) => ({ ...current, evidenceObjectKey: uploaded.objectKey }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '증빙 이미지를 준비하지 못했습니다.');
      event.target.value = '';
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.building.trim() || !form.unit.trim()) {
      setMessage('동과 호수는 필수입니다.');
      return;
    }
    if (form.method === 'document' && !form.evidenceObjectKey) {
      setMessage('서류 인증은 증빙 이미지가 필요합니다.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const next = await residentVerificationAdapter.submit({
        ...form,
        building: form.building.trim(),
        unit: form.unit.trim()
      });
      setState(next);
      setMessage('입주민 인증 신청이 접수되었습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '입주민 인증 신청에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return <main className="verification-shell"><p>입주민 인증 정보를 불러오는 중입니다.</p></main>;
  }

  const editable = state.status === 'unverified' || state.status === 'rejected';

  return (
    <main className="verification-shell">
      <header className="verification-header">
        <div><span>DANJION RESIDENT</span><h1>입주민 인증</h1><p>{state.complexName} · 로그인과 별도로 실제 입주민 여부를 확인합니다.</p></div>
        <a href="/">단지온으로 돌아가기</a>
      </header>

      {message && <button className="verification-message" onClick={() => setMessage('')}>{message}</button>}

      <section className={`verification-status status-${state.status}`}>
        <div><small>현재 상태</small><strong>{statusLabels[state.status]}</strong></div>
        <p>{state.status === 'verified' ? '인증 주민에게만 공개되는 연락처와 주민 전용 기능을 사용할 수 있습니다.' : state.status === 'pending' ? '관리자가 신청 내용을 확인하고 있습니다.' : state.status === 'rejected' ? '반려 사유를 확인하고 내용을 수정해 다시 신청할 수 있습니다.' : '동·호수와 인증 방법을 입력해 신청해 주세요.'}</p>
        {state.note && <blockquote>{state.note}</blockquote>}
      </section>

      {state.status === 'verified' && (
        <section className="verification-card">
          <h2>인증 정보</h2>
          <dl><div><dt>단지</dt><dd>{state.complexName}</dd></div><div><dt>동</dt><dd>{state.building}</dd></div><div><dt>호수</dt><dd>{state.unit}</dd></div><div><dt>인증 방식</dt><dd>{state.method || '-'}</dd></div></dl>
          <p className="privacy-note">정확한 동·호수는 다른 주민에게 공개하지 않습니다.</p>
        </section>
      )}

      {state.status === 'pending' && (
        <section className="verification-card"><h2>신청 내용</h2><dl><div><dt>동</dt><dd>{state.building}</dd></div><div><dt>호수</dt><dd>{state.unit}</dd></div><div><dt>방식</dt><dd>{state.method}</dd></div><div><dt>신청일</dt><dd>{state.requestedAt ? new Date(state.requestedAt).toLocaleString('ko-KR') : '-'}</dd></div></dl></section>
      )}

      {editable && (
        <form className="verification-form" onSubmit={(event) => void submit(event)}>
          <h2>{state.status === 'rejected' ? '인증 내용 보완' : '인증 신청'}</h2>
          <div className="verification-grid">
            <label><span>동 *</span><input value={form.building} maxLength={20} onChange={(event) => setForm({ ...form, building: event.target.value })} placeholder="예: 101" /></label>
            <label><span>호수 *</span><input value={form.unit} maxLength={20} onChange={(event) => setForm({ ...form, unit: event.target.value })} placeholder="예: 1001" /></label>
            <label className="full"><span>인증 방법</span><select value={form.method} onChange={(event) => setForm({ ...form, method: event.target.value as ResidentVerificationMethod })}><option value="management_confirmation">관리사무소 확인</option><option value="document">서류·고지서 이미지</option><option value="manual">운영자 수동 확인</option></select></label>
          </div>
          {form.method === 'document' && <div className="evidence-upload"><strong>증빙 이미지</strong><p>동·호수 확인에 필요한 부분만 제출하세요. 실제 서비스에서는 비공개 저장소와 보관기한 정책을 적용합니다.</p><label><input type="file" accept="image/*" onChange={(event) => void chooseEvidence(event)} disabled={busy} /><span>{evidence ? '다른 이미지 선택' : form.evidenceObjectKey ? '기존 증빙 교체' : '증빙 이미지 선택'}</span></label>{evidence?.previewUrl && <img src={evidence.previewUrl} alt="입주민 인증 증빙 미리보기" />}</div>}
          <button className="verification-primary" disabled={busy}>{busy ? '처리 중...' : state.status === 'rejected' ? '다시 인증 신청' : '입주민 인증 신청'}</button>
        </form>
      )}
    </main>
  );
}
