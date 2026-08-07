import { useEffect, useState, type FormEvent } from 'react';
import {
  adminAdapter,
  type AdminApplication,
  type AdminApplicationStatus,
  type AdminBusiness,
  type AdminReviewEvent
} from './admin-api';

type AdminTab = 'applications' | 'audit' | 'posts' | 'benefits';
type ReviewStatus = Exclude<AdminApplicationStatus, 'draft'>;

const statusLabels: Record<AdminApplicationStatus, string> = {
  draft: '작성 중',
  pending: '확인 대기',
  changes_requested: '보완 요청',
  approved: '승인',
  rejected: '반려'
};

const actorLabels: Record<AdminReviewEvent['actorType'], string> = {
  applicant: '신청자',
  manager: '관리자',
  system: '시스템'
};

function canReview(status: AdminApplicationStatus) {
  return status === 'pending' || status === 'changes_requested';
}

function formatDateTime(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date);
}

export default function AdminApp() {
  const [tab, setTab] = useState<AdminTab>('applications');
  const [applications, setApplications] = useState<AdminApplication[]>([]);
  const [businesses, setBusinesses] = useState<AdminBusiness[]>([]);
  const [reviewEvents, setReviewEvents] = useState<AdminReviewEvent[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [auditApplicationId, setAuditApplicationId] = useState('all');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [postForm, setPostForm] = useState({ sourceName: '단지온 운영자', category: '주민 사업자 소식', title: '', body: '' });
  const [benefitForm, setBenefitForm] = useState({ businessId: '', title: '', description: '', conditions: '방림명지로드힐 인증 입주민 대상' });

  async function loadApplications(filter = statusFilter) {
    try {
      const rows = await adminAdapter.listApplications(filter);
      setApplications(rows);
      setNotes(Object.fromEntries(rows.map((row) => [row.id, row.reviewNote || ''])));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '신청 목록을 불러오지 못했습니다.');
    }
  }

  async function loadBusinesses() {
    try {
      setBusinesses(await adminAdapter.listBusinesses());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '가게 목록을 불러오지 못했습니다.');
    }
  }

  async function loadReviewEvents(applicationId = auditApplicationId) {
    try {
      const rows = await adminAdapter.listReviewEvents(applicationId === 'all' ? null : applicationId);
      setReviewEvents(rows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '검토 이력을 불러오지 못했습니다.');
    }
  }

  useEffect(() => {
    void loadApplications('all');
    void loadBusinesses();
  }, []);

  async function changeFilter(value: string) {
    setStatusFilter(value);
    await loadApplications(value);
  }

  async function changeAuditFilter(value: string) {
    setAuditApplicationId(value);
    await loadReviewEvents(value);
  }

  async function openTab(next: AdminTab) {
    setTab(next);
    setMessage('');
    if (next === 'audit') await loadReviewEvents(auditApplicationId);
    if (next === 'benefits') await loadBusinesses();
  }

  async function review(application: AdminApplication, status: ReviewStatus) {
    if (!canReview(application.status)) return;
    setBusyId(application.id);
    setMessage('');
    try {
      await adminAdapter.reviewApplication(application.id, status, notes[application.id] || '');
      setMessage(`${application.businessName} 신청을 '${statusLabels[status]}' 상태로 변경했습니다.`);
      await loadApplications(statusFilter);
      if (status === 'approved') await loadBusinesses();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '검토 상태를 변경하지 못했습니다.');
    } finally {
      setBusyId('');
    }
  }

  async function submitPost(event: FormEvent) {
    event.preventDefault();
    if (!postForm.title.trim() || !postForm.body.trim()) {
      setMessage('공지 제목과 내용은 필수입니다.');
      return;
    }
    setBusyId('post');
    try {
      await adminAdapter.createPost(postForm);
      setPostForm((current) => ({ ...current, title: '', body: '' }));
      setMessage('단지소식을 게시했습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '단지소식을 게시하지 못했습니다.');
    } finally {
      setBusyId('');
    }
  }

  async function submitBenefit(event: FormEvent) {
    event.preventDefault();
    if (!benefitForm.businessId || !benefitForm.title.trim()) {
      setMessage('대상 가게와 혜택 제목은 필수입니다.');
      return;
    }
    setBusyId('benefit');
    try {
      await adminAdapter.createBenefit(benefitForm);
      setBenefitForm((current) => ({ ...current, title: '', description: '' }));
      setMessage('주민혜택을 등록했습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '주민혜택을 등록하지 못했습니다.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="admin-app">
      <header className="admin-header">
        <div>
          <span className="admin-eyebrow">DANJION OPERATIONS</span>
          <h1>단지온 운영관리</h1>
          <p>방림명지로드힐 · 개발/검증용 운영 화면</p>
        </div>
        <a href="/">주민 화면 보기</a>
      </header>

      <nav className="admin-tabs" aria-label="운영관리 메뉴">
        <button className={tab === 'applications' ? 'active' : ''} onClick={() => void openTab('applications')}>등록 신청</button>
        <button className={tab === 'audit' ? 'active' : ''} onClick={() => void openTab('audit')}>검토 이력</button>
        <button className={tab === 'posts' ? 'active' : ''} onClick={() => void openTab('posts')}>단지소식</button>
        <button className={tab === 'benefits' ? 'active' : ''} onClick={() => void openTab('benefits')}>주민혜택</button>
      </nav>

      {message && <button className="admin-message" onClick={() => setMessage('')}>{message}</button>}

      {tab === 'applications' && (
        <main className="admin-section">
          <div className="admin-section-heading">
            <div><h2>가게·서비스 등록 신청</h2><p>신청 내용을 검토하고 보완·승인·반려 상태를 관리합니다.</p></div>
            <select aria-label="등록 신청 상태 필터" value={statusFilter} onChange={(event) => void changeFilter(event.target.value)}>
              <option value="all">전체 상태</option>
              <option value="draft">작성 중</option>
              <option value="pending">확인 대기</option>
              <option value="changes_requested">보완 요청</option>
              <option value="approved">승인</option>
              <option value="rejected">반려</option>
            </select>
          </div>

          <div className="admin-application-list">
            {applications.map((application) => (
              <article key={application.id} className="admin-application-card">
                <div className="admin-card-top">
                  <div>
                    <span>{application.applicantName} · {application.relationType}</span>
                    <h3>{application.businessName}</h3>
                    <b>{application.categoryName}</b>
                  </div>
                  <span className={`admin-status ${application.status}`}>{statusLabels[application.status]}</span>
                </div>
                <p className="admin-summary">{application.serviceSummary}</p>
                <dl>
                  <div><dt>가격</dt><dd>{application.priceText || '미입력'}</dd></div>
                  <div><dt>지역</dt><dd>{application.serviceArea || '미입력'}</dd></div>
                  <div><dt>이용시간</dt><dd>{application.availabilityText || '미입력'}</dd></div>
                  <div><dt>주민혜택</dt><dd>{application.benefitText || '없음'}</dd></div>
                </dl>
                <label className="review-note"><span>검토 메모</span><textarea value={notes[application.id] || ''} onChange={(event) => setNotes((current) => ({ ...current, [application.id]: event.target.value }))} rows={2} placeholder="보완 요청 사유 또는 내부 검토 메모" disabled={!canReview(application.status)} /></label>
                <div className="review-actions">
                  <button disabled={busyId === application.id || !canReview(application.status)} onClick={() => void review(application, 'changes_requested')}>보완 요청</button>
                  <button className="reject" disabled={busyId === application.id || !canReview(application.status)} onClick={() => void review(application, 'rejected')}>반려</button>
                  <button className="approve" disabled={busyId === application.id || !canReview(application.status)} onClick={() => void review(application, 'approved')}>{busyId === application.id ? '처리 중...' : '승인'}</button>
                </div>
              </article>
            ))}
            {!applications.length && <div className="admin-empty">조건에 맞는 신청이 없습니다.</div>}
          </div>
        </main>
      )}

      {tab === 'audit' && (
        <main className="admin-section">
          <div className="admin-section-heading">
            <div><h2>등록 신청 검토 이력</h2><p>보완 요청, 신청자 재제출, 승인·반려의 상태 변경을 시간순으로 확인합니다.</p></div>
            <select aria-label="검토 이력 신청 필터" value={auditApplicationId} onChange={(event) => void changeAuditFilter(event.target.value)}>
              <option value="all">모든 신청</option>
              {applications.map((application) => <option key={application.id} value={application.id}>{application.businessName}</option>)}
            </select>
          </div>
          <div className="audit-list">
            {reviewEvents.map((event) => (
              <article className="audit-event" key={event.id}>
                <div className="audit-dot" aria-hidden="true" />
                <div className="audit-copy">
                  <div className="audit-topline"><strong>{event.businessName}</strong><time>{formatDateTime(event.createdAt)}</time></div>
                  <p><b>{actorLabels[event.actorType]}</b> · {event.actorName}</p>
                  <div className="audit-transition"><span>{event.fromStatus ? statusLabels[event.fromStatus] : '시작'}</span><i>→</i><strong>{statusLabels[event.toStatus]}</strong></div>
                  {event.reviewNote && <blockquote>{event.reviewNote}</blockquote>}
                </div>
              </article>
            ))}
            {!reviewEvents.length && <div className="admin-empty">기록된 검토 이력이 없습니다.</div>}
          </div>
        </main>
      )}

      {tab === 'posts' && (
        <main className="admin-section narrow">
          <div className="admin-section-heading"><div><h2>단지소식 작성</h2><p>주민에게 필요한 소식을 간단하고 명확하게 게시합니다.</p></div></div>
          <form className="admin-form" onSubmit={(event) => void submitPost(event)}>
            <label><span>출처</span><input value={postForm.sourceName} onChange={(event) => setPostForm({ ...postForm, sourceName: event.target.value })} /></label>
            <label><span>분류</span><input value={postForm.category} onChange={(event) => setPostForm({ ...postForm, category: event.target.value })} /></label>
            <label className="full"><span>제목</span><input value={postForm.title} onChange={(event) => setPostForm({ ...postForm, title: event.target.value })} placeholder="예: 8월 입주자대표회의 활동 안내" /></label>
            <label className="full"><span>내용</span><textarea value={postForm.body} onChange={(event) => setPostForm({ ...postForm, body: event.target.value })} rows={8} /></label>
            <button className="admin-primary" disabled={busyId === 'post'}>{busyId === 'post' ? '게시 중...' : '단지소식 게시'}</button>
          </form>
        </main>
      )}

      {tab === 'benefits' && (
        <main className="admin-section narrow">
          <div className="admin-section-heading"><div><h2>주민혜택 등록</h2><p>승인된 가게·서비스에 단지 전용 혜택을 연결합니다.</p></div></div>
          <form className="admin-form" onSubmit={(event) => void submitBenefit(event)}>
            <label className="full"><span>대상 가게·서비스</span><select value={benefitForm.businessId} onChange={(event) => setBenefitForm({ ...benefitForm, businessId: event.target.value })}><option value="">선택하세요</option>{businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}</select></label>
            <label className="full"><span>혜택 제목</span><input value={benefitForm.title} onChange={(event) => setBenefitForm({ ...benefitForm, title: event.target.value })} placeholder="예: 첫 방문 10% 할인" /></label>
            <label className="full"><span>설명</span><textarea value={benefitForm.description} onChange={(event) => setBenefitForm({ ...benefitForm, description: event.target.value })} rows={4} /></label>
            <label className="full"><span>이용 조건</span><input value={benefitForm.conditions} onChange={(event) => setBenefitForm({ ...benefitForm, conditions: event.target.value })} /></label>
            <button className="admin-primary" disabled={busyId === 'benefit'}>{busyId === 'benefit' ? '등록 중...' : '주민혜택 등록'}</button>
          </form>
        </main>
      )}
    </div>
  );
}
