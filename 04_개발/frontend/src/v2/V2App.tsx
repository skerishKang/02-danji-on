import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { adminAdapter } from '../admin-api';
import { dataAdapter } from '../api/adapter';
import { authProvider } from '../auth';
import type {
  Benefit,
  BenefitClaim,
  Business,
  BusinessApplication,
  BusinessApplicationInput,
  BusinessContact,
  BusinessFilters
} from '../types';
import {
  V2BenefitFlow,
  V2DetailFlow,
  V2DiscoveryFlow,
  V2OperatorReviewFlow,
  V2PromotionFlow,
  V2RegistrationFlow
} from './flows/V2ProductFlows';
import './v2-flow.css';

export type V2FlowView = 'discover' | 'results' | 'detail' | 'benefits' | 'register' | 'promo' | 'operator';

export interface V2FlowVisualSlots {
  hero?: ReactNode;
  cinematic?: ReactNode;
  businessMedia?: (business: Business, context: 'card' | 'detail') => ReactNode;
  promotionMedia?: (application: BusinessApplication) => ReactNode;
}

export interface V2AppProps {
  visualSlots?: V2FlowVisualSlots;
}

const journey = [
  ['discover', '발견'],
  ['results', '검색'],
  ['detail', '상세'],
  ['benefits', '주민혜택'],
  ['register', '내 일 알리기'],
  ['promo', '홍보물'],
  ['operator', '운영확인/승인'],
  ['rediscover', '다시 발견']
] as const;

type JourneyKey = (typeof journey)[number][0];

function applicationToInput(application: BusinessApplication): BusinessApplicationInput {
  return {
    relationType: application.relationType,
    businessName: application.businessName,
    categoryName: application.categoryName,
    serviceSummary: application.serviceSummary,
    priceText: application.priceText,
    contactMethod: application.contactMethod,
    serviceArea: application.serviceArea,
    benefitText: application.benefitText,
    availabilityText: application.availabilityText,
    representativeImageObjectKey: application.representativeImageObjectKey
  };
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function V2App({ visualSlots = {} }: V2AppProps) {
  const residentAuth = useMemo(() => authProvider.snapshot('resident'), []);
  const adminAuth = useMemo(() => authProvider.snapshot('admin'), []);
  const [view, setView] = useState<V2FlowView>('discover');
  const [allBusinesses, setAllBusinesses] = useState<Business[]>([]);
  const [results, setResults] = useState<Business[]>([]);
  const [benefits, setBenefits] = useState<Benefit[]>([]);
  const [claims, setClaims] = useState<BenefitClaim[]>([]);
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());
  const [applications, setApplications] = useState<BusinessApplication[]>([]);
  const [activeApplication, setActiveApplication] = useState<BusinessApplication | null>(null);
  const [editingApplication, setEditingApplication] = useState<BusinessApplication | null>(null);
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null);
  const [contacts, setContacts] = useState<BusinessContact[]>([]);
  const [filters, setFilters] = useState<BusinessFilters>({ relation: 'all' });
  const [highlightBusinessId, setHighlightBusinessId] = useState<string | null>(null);
  const [promotionGenerated, setPromotionGenerated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [completed, setCompleted] = useState<Set<JourneyKey>>(new Set(['discover']));

  const categories = useMemo(() => {
    const unique = new Map<string, string>();
    allBusinesses.forEach((business) => unique.set(business.categorySlug, business.categoryName));
    return [...unique.entries()];
  }, [allBusinesses]);

  function mark(...steps: JourneyKey[]) {
    setCompleted((current) => new Set([...current, ...steps]));
  }

  async function loadBaseData() {
    setBusy(true);
    setMessage('');
    try {
      const [businessRows, benefitRows, bookmarkRows, applicationRows, claimRows] = await Promise.all([
        dataAdapter.listBusinesses(),
        dataAdapter.listBenefits(),
        dataAdapter.getBookmarks().catch(() => []),
        dataAdapter.listMyBusinessApplications().catch(() => []),
        dataAdapter.listBenefitClaims().catch(() => [])
      ]);
      setAllBusinesses(businessRows);
      setResults(businessRows);
      setBenefits(benefitRows);
      setBookmarks(new Set(bookmarkRows));
      setApplications(applicationRows);
      setClaims(claimRows);
    } catch (error) {
      setMessage(errorMessage(error, 'V2 상품 데이터를 불러오지 못했습니다.'));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadBaseData();
  }, []);

  async function searchBusinesses(next: BusinessFilters) {
    setBusy(true);
    setMessage('');
    try {
      const normalized: BusinessFilters = {
        query: next.query?.trim() || undefined,
        category: next.category && next.category !== 'all' ? next.category : undefined,
        relation: next.relation || 'all'
      };
      const rows = await dataAdapter.listBusinesses(normalized);
      setFilters({ ...next, query: next.query?.trim() || '' });
      setResults(rows);
      setView('results');
      setHighlightBusinessId(null);
      mark('results');
    } catch (error) {
      setMessage(errorMessage(error, '검색에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  }

  async function resetDiscovery() {
    setFilters({ relation: 'all' });
    setHighlightBusinessId(null);
    setSelectedBusiness(null);
    setContacts([]);
    setView('discover');
    await loadBaseData();
  }

  async function openBusiness(id: string) {
    setBusy(true);
    setMessage('');
    setContacts([]);
    try {
      const business = await dataAdapter.getBusiness(id);
      if (!business) {
        setMessage('가게·서비스를 찾을 수 없습니다.');
        return;
      }
      setSelectedBusiness(business);
      setView('detail');
      mark('detail');
    } catch (error) {
      setMessage(errorMessage(error, '상세 정보를 불러오지 못했습니다.'));
    } finally {
      setBusy(false);
    }
  }

  async function revealContacts() {
    if (!selectedBusiness) return;
    setBusy(true);
    setMessage('');
    try {
      const rows = await dataAdapter.getBusinessContacts(selectedBusiness.id);
      setContacts(rows);
      setMessage(rows.length ? '기존 resident-verification/권한 계약을 통과한 문의 방법입니다.' : '등록된 문의 방법이 없습니다.');
    } catch (error) {
      setMessage(errorMessage(error, '문의 방법은 인증된 입주민만 확인할 수 있습니다.'));
    } finally {
      setBusy(false);
    }
  }

  async function toggleBookmark(id: string) {
    const next = new Set(bookmarks);
    setMessage('');
    try {
      if (next.has(id)) {
        await dataAdapter.removeBookmark(id);
        next.delete(id);
      } else {
        await dataAdapter.addBookmark(id);
        next.add(id);
      }
      setBookmarks(next);
    } catch (error) {
      setMessage(errorMessage(error, '저장 상태를 바꾸지 못했습니다.'));
    }
  }

  async function refreshClaims() {
    try {
      setClaims(await dataAdapter.listBenefitClaims());
    } catch (error) {
      setMessage(errorMessage(error, '혜택 보관 상태를 확인하지 못했습니다.'));
    }
  }

  async function claimBenefit(benefitId: string) {
    setBusy(true);
    setMessage('');
    try {
      await dataAdapter.claimBenefit(benefitId);
      await refreshClaims();
      setView('benefits');
      mark('benefits');
      setMessage('주민혜택을 기존 혜택 지갑 계약으로 보관했습니다.');
    } catch (error) {
      setMessage(errorMessage(error, '주민혜택을 받지 못했습니다.'));
    } finally {
      setBusy(false);
    }
  }

  async function useBenefit(benefitId: string) {
    setBusy(true);
    setMessage('');
    try {
      await dataAdapter.useBenefit(benefitId);
      await refreshClaims();
      setMessage('혜택을 사용 완료 상태로 변경했습니다.');
    } catch (error) {
      setMessage(errorMessage(error, '혜택 상태를 변경하지 못했습니다.'));
    } finally {
      setBusy(false);
    }
  }

  function startRegistration(application?: BusinessApplication) {
    setEditingApplication(application ?? null);
    setView('register');
    setMessage('');
    mark('register');
  }

  async function submitApplication(input: BusinessApplicationInput) {
    setBusy(true);
    setMessage('');
    try {
      const submitted = editingApplication
        ? await dataAdapter.resubmitBusinessApplication(editingApplication.id, input)
        : await dataAdapter.createBusinessApplication(input);
      const latest = await dataAdapter.listMyBusinessApplications().catch(() => [submitted, ...applications.filter((item) => item.id !== submitted.id)]);
      setApplications(latest);
      setActiveApplication(latest.find((item) => item.id === submitted.id) ?? submitted);
      setEditingApplication(null);
      setPromotionGenerated(false);
      setView('promo');
      mark('promo');
      setMessage('등록 신청이 기존 application 계약으로 접수되었습니다. 다음은 홍보물 미리보기 단계입니다.');
    } catch (error) {
      setMessage(errorMessage(error, editingApplication ? '보완 내용을 다시 제출하지 못했습니다.' : '등록 신청을 접수하지 못했습니다.'));
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function openOperatorReview() {
    if (!activeApplication) return;
    setView('operator');
    setMessage('');
    mark('operator');
  }

  async function handleReview(status: 'changes_requested' | 'approved' | 'rejected', note: string) {
    if (!activeApplication) return;
    setBusy(true);
    setMessage('');
    try {
      await adminAdapter.reviewApplication(activeApplication.id, status, note);
      const latestApplications = await dataAdapter.listMyBusinessApplications().catch(() => applications);
      const updatedApplication = latestApplications.find((item) => item.id === activeApplication.id) ?? {
        ...activeApplication,
        status,
        reviewNote: note || null
      };
      setApplications(latestApplications);
      setActiveApplication(updatedApplication);

      if (status !== 'approved') {
        setMessage(status === 'changes_requested'
          ? '기존 관리자 검토 계약으로 보완 요청 상태가 되었습니다.'
          : '기존 관리자 검토 계약으로 반려 상태가 되었습니다.');
        return;
      }

      const [nextBusinesses, nextBenefits, everyBusiness] = await Promise.all([
        dataAdapter.listBusinesses({ query: updatedApplication.businessName }),
        dataAdapter.listBenefits(),
        dataAdapter.listBusinesses()
      ]);
      setAllBusinesses(everyBusiness);
      setResults(nextBusinesses);
      setBenefits(nextBenefits);
      setFilters({ query: updatedApplication.businessName, relation: 'all' });
      const approvedId = updatedApplication.approvedBusinessId
        ?? nextBusinesses.find((business) => business.name === updatedApplication.businessName)?.id
        ?? null;
      setHighlightBusinessId(approvedId);
      setView('results');
      mark('rediscover');
      setMessage('승인 완료. 기존 승인 materialization을 거쳐 검색 결과에서 다시 발견됩니다.');
    } catch (error) {
      setMessage(errorMessage(error, '운영 확인 권한 또는 승인 처리에 실패했습니다.'));
      throw error;
    } finally {
      setBusy(false);
    }
  }

  const activeJourney = view === 'discover' ? 'discover' : view;

  return (
    <div className="v2-app" data-v2-flow-view={view}>
      <a className="v2-skip" href="#v2-main">본문으로 바로가기</a>
      <header className="v2-topbar">
        <button type="button" className="v2-wordmark" onClick={() => void resetDiscovery()}>단지온 <span>V2</span></button>
        <nav aria-label="V2 주요 메뉴">
          <button type="button" onClick={() => void resetDiscovery()}>발견</button>
          <button type="button" onClick={() => void searchBusinesses({ relation: 'all' })}>이웃가게</button>
          <button type="button" onClick={() => { setView('benefits'); mark('benefits'); }}>주민혜택</button>
          <button type="button" onClick={() => startRegistration()}>내 일 알리기</button>
        </nav>
        <div className="v2-contract-state" title="최종 로그인 provider 결정은 이 트랙의 범위가 아닙니다.">
          <span>{residentAuth.mode} auth interface</span>
          <b>서버 권한 계약 유지</b>
        </div>
      </header>

      <div className="v2-journey" aria-label="V2 제품 흐름">
        {journey.map(([key, label], index) => (
          <div key={key} className={completed.has(key) ? 'done' : key === activeJourney ? 'active' : ''}>
            <span>{String(index + 1).padStart(2, '0')}</span><b>{label}</b>
          </div>
        ))}
      </div>

      <main id="v2-main" aria-busy={busy}>
        {view === 'discover' && (
          <V2DiscoveryFlow
            mode="discover"
            businesses={allBusinesses}
            categories={categories}
            filters={filters}
            bookmarks={bookmarks}
            highlightBusinessId={highlightBusinessId}
            visualSlots={visualSlots}
            onSearch={searchBusinesses}
            onOpenBusiness={openBusiness}
            onToggleBookmark={toggleBookmark}
            onOpenBenefits={() => { setView('benefits'); mark('benefits'); }}
            onOpenRegister={() => startRegistration()}
          />
        )}
        {view === 'results' && (
          <V2DiscoveryFlow
            mode="results"
            businesses={results}
            categories={categories}
            filters={filters}
            bookmarks={bookmarks}
            highlightBusinessId={highlightBusinessId}
            visualSlots={visualSlots}
            onSearch={searchBusinesses}
            onOpenBusiness={openBusiness}
            onToggleBookmark={toggleBookmark}
            onOpenBenefits={() => { setView('benefits'); mark('benefits'); }}
            onOpenRegister={() => startRegistration()}
          />
        )}
        {view === 'detail' && selectedBusiness && (
          <V2DetailFlow
            business={selectedBusiness}
            contacts={contacts}
            bookmarked={bookmarks.has(selectedBusiness.id)}
            visualSlots={visualSlots}
            busy={busy}
            onBack={() => setView('results')}
            onToggleBookmark={() => void toggleBookmark(selectedBusiness.id)}
            onRevealContacts={() => void revealContacts()}
            onClaimBenefit={(benefitId) => void claimBenefit(benefitId)}
          />
        )}
        {view === 'benefits' && (
          <V2BenefitFlow
            benefits={benefits}
            claims={claims}
            busy={busy}
            onClaim={(benefitId) => void claimBenefit(benefitId)}
            onUse={(benefitId) => void useBenefit(benefitId)}
            onOpenBusiness={(businessId) => void openBusiness(businessId)}
            onOpenRegister={() => startRegistration()}
          />
        )}
        {view === 'register' && (
          <V2RegistrationFlow
            categoryNames={categories.map(([, name]) => name)}
            busy={busy}
            initialValue={editingApplication ? applicationToInput(editingApplication) : undefined}
            mode={editingApplication ? 'resubmit' : 'create'}
            reviewNote={editingApplication?.reviewNote}
            onSubmit={submitApplication}
            onCancel={() => setView('discover')}
          />
        )}
        {view === 'promo' && activeApplication && (
          <V2PromotionFlow
            application={activeApplication}
            generated={promotionGenerated}
            visualSlots={visualSlots}
            onGenerate={() => { setPromotionGenerated(true); mark('promo'); }}
            onOpenOperator={() => void openOperatorReview()}
            onEditApplication={activeApplication.status === 'changes_requested' ? () => startRegistration(activeApplication) : undefined}
            onBackDiscovery={() => void resetDiscovery()}
          />
        )}
        {view === 'operator' && activeApplication && (
          <V2OperatorReviewFlow
            application={activeApplication}
            busy={busy}
            adminAuthMode={adminAuth.mode}
            onReview={handleReview}
            onBack={() => setView('promo')}
          />
        )}
      </main>

      <section className="v2-application-dock" aria-label="내 등록 신청 상태">
        <div><span>내 등록 신청</span><b>{applications.length}건</b></div>
        <div className="v2-application-dock-list">
          {applications.slice(0, 4).map((application) => (
            <button
              type="button"
              key={application.id}
              onClick={() => {
                setActiveApplication(application);
                if (application.status === 'changes_requested') startRegistration(application);
                else { setView('promo'); setPromotionGenerated(application.status === 'approved'); }
              }}
            >
              <strong>{application.businessName}</strong>
              <span>{application.status}</span>
            </button>
          ))}
          {!applications.length && <span>아직 신청이 없습니다.</span>}
        </div>
      </section>

      <footer className="v2-footer">
        <strong>DanjiOn V2 · Product Flow Track</strong>
        <span>V1 API/DB/Auth/Storage 계약 재사용 · 최종 로그인 provider 미결정 상태 유지 · production deploy 없음</span>
      </footer>
      {message && <button type="button" className="v2-toast" onClick={() => setMessage('')}>{message}</button>}
    </div>
  );
}
