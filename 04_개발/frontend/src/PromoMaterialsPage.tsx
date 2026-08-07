import { useEffect, useMemo, useRef, useState } from 'react';
import { dataAdapter } from './api/adapter';
import { storageAdapter } from './storage';
import { relationLabels, type BusinessApplication } from './types';
import './promo-materials.css';

type LoadState = 'loading' | 'ready' | 'missing' | 'error';

function applicationIdFromLocation() {
  return new URLSearchParams(window.location.search).get('application')?.trim() ?? '';
}

function fallbackScene(application: BusinessApplication) {
  const value = `${application.categoryName} ${application.businessName}`;
  if (/반찬|음식|카페|베이킹|먹거리/.test(value)) return 'food';
  if (/수학|과외|수업|교육|영어/.test(value)) return 'learning';
  if (/수리|청소|에어컨|방충망|홈/.test(value)) return 'home';
  return 'professional';
}

function statusLabel(application: BusinessApplication) {
  return application.status === 'approved' ? '승인 완료' : '등록 대기';
}

function displayBenefit(application: BusinessApplication) {
  return application.benefitText?.trim() || '주민혜택은 등록 후 안내합니다.';
}

function displayPrice(application: BusinessApplication) {
  return application.priceText?.trim() || '상담 후 안내';
}

function displayArea(application: BusinessApplication) {
  return application.serviceArea?.trim() || '방림동과 인근 지역';
}

function PromoPhoto({ application, previewUrl, format }: { application: BusinessApplication; previewUrl: string | null; format: string }) {
  const scene = fallbackScene(application);
  if (previewUrl) {
    return <img className="promo-photo-image" src={previewUrl} alt={`${application.businessName} 대표 사진 · ${format}`} />;
  }
  return (
    <div className={`promo-photo-fallback scene-${scene}`} role="img" aria-label={`${application.businessName} 대표 작업장면 기본 이미지`}>
      <span>대표 작업장면</span>
    </div>
  );
}

function ListingCard({ application, previewUrl }: { application: BusinessApplication; previewUrl: string | null }) {
  return (
    <article className="promo-artwork listing-artwork" aria-label="단지온 가게소개 카드 미리보기">
      <div className="artwork-photo"><PromoPhoto application={application} previewUrl={previewUrl} format="가게소개 카드" /></div>
      <div className="listing-copy">
        <span className="artwork-kicker">단지온 · 방림명지로드힐</span>
        <span className="artwork-relation">{relationLabels[application.relationType]}</span>
        <h2>{application.businessName}</h2>
        <p>{application.serviceSummary}</p>
        <strong>{displayBenefit(application)}</strong>
        <div className="artwork-meta"><span>{displayPrice(application)}</span><span>{displayArea(application)}</span></div>
      </div>
    </article>
  );
}

function KakaoCard({ application, previewUrl }: { application: BusinessApplication; previewUrl: string | null }) {
  return (
    <article className="promo-artwork kakao-artwork" aria-label="카카오톡 공유 이미지 미리보기">
      <div className="kakao-photo"><PromoPhoto application={application} previewUrl={previewUrl} format="카카오톡 공유 이미지" /></div>
      <div className="kakao-overlay">
        <span>우리 단지 이웃의 일</span>
        <h2>{application.businessName}</h2>
        <p>{application.serviceSummary}</p>
        <strong>{displayBenefit(application)}</strong>
        <small>단지온 · 방림명지로드힐</small>
      </div>
    </article>
  );
}

function ElevatorPoster({ application, previewUrl }: { application: BusinessApplication; previewUrl: string | null }) {
  return (
    <article className="promo-artwork elevator-artwork" aria-label="엘리베이터 게시판 포스터 미리보기">
      <header><span>방림명지로드힐 주민 이웃가게</span><b>단지온</b></header>
      <div className="poster-photo"><PromoPhoto application={application} previewUrl={previewUrl} format="엘리베이터 게시판 포스터" /></div>
      <div className="poster-copy">
        <span>{application.categoryName}</span>
        <h2>{application.businessName}</h2>
        <p>{application.serviceSummary}</p>
        <strong>{displayBenefit(application)}</strong>
        <dl>
          <div><dt>이용지역</dt><dd>{displayArea(application)}</dd></div>
          <div><dt>가격</dt><dd>{displayPrice(application)}</dd></div>
        </dl>
        <footer>단지온에서 자세한 정보와 문의 방법을 확인하세요.</footer>
      </div>
    </article>
  );
}

function WaitingOutput({ label, index, built, children }: { label: string; index: number; built: boolean; children: React.ReactNode }) {
  return (
    <section className={`promo-output ${built ? 'is-built' : 'is-waiting'}`} aria-live="polite" data-output-index={index}>
      <div className="promo-output-heading"><span>0{index}</span><h2>{label}</h2><b>{built ? '완성' : '대기'}</b></div>
      {built ? children : <div className="promo-waiting-surface"><span>홍보물 만들기를 누르면 등록정보가 이 형식에 맞게 정돈됩니다.</span></div>}
    </section>
  );
}

export default function PromoMaterialsPage() {
  const applicationId = useMemo(applicationIdFromLocation, []);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [application, setApplication] = useState<BusinessApplication | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [builtCount, setBuiltCount] = useState(0);
  const [building, setBuilding] = useState(false);
  const timerRefs = useRef<number[]>([]);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!applicationId) {
        setLoadState('missing');
        return;
      }
      try {
        const detail = await dataAdapter.getMyBusinessApplication(applicationId);
        if (!active) return;
        if (!detail) {
          setLoadState('missing');
          return;
        }
        if (detail.status === 'rejected') {
          setApplication(detail);
          setLoadState('missing');
          return;
        }
        setApplication(detail);
        setLoadState('ready');
        if (detail.representativeImageObjectKey && storageAdapter.resolvePreview) {
          const resolved = await storageAdapter.resolvePreview(detail.representativeImageObjectKey);
          if (!active) {
            if (resolved) storageAdapter.releasePreviewUrl?.(resolved);
            return;
          }
          setPreviewUrl(resolved);
        }
      } catch {
        if (active) setLoadState('error');
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [applicationId]);

  useEffect(() => () => {
    timerRefs.current.forEach((timer) => window.clearTimeout(timer));
    if (previewUrl) storageAdapter.releasePreviewUrl?.(previewUrl);
  }, [previewUrl]);

  function buildMaterials() {
    if (building || builtCount === 3) return;
    setBuilding(true);
    setBuiltCount(0);
    [1, 2, 3].forEach((count, index) => {
      const timer = window.setTimeout(() => {
        setBuiltCount(count);
        if (count === 3) setBuilding(false);
      }, 110 * (index + 1));
      timerRefs.current.push(timer);
    });
  }

  function goBack() {
    if (window.history.length > 1) window.history.back();
    else window.location.assign('/');
  }

  if (loadState === 'loading') {
    return <main className="promo-page"><div className="promo-state-card">등록정보를 불러오는 중입니다.</div></main>;
  }

  if (loadState !== 'ready' || !application) {
    return (
      <main className="promo-page">
        <div className="promo-state-card">
          <span>홍보물 만들기</span>
          <h1>사용할 수 있는 등록 신청을 찾지 못했습니다.</h1>
          <p>확인 대기 또는 승인된 내 가게·서비스에서 다시 시작해 주세요.</p>
          <button type="button" onClick={goBack}>돌아가기</button>
        </div>
      </main>
    );
  }

  return (
    <main className="promo-page">
      <header className="promo-topbar">
        <button className="promo-wordmark" type="button" onClick={() => window.location.assign('/')}>단지온</button>
        <span>방림명지로드힐</span>
        <button className="promo-back" type="button" onClick={goBack}>내정보로 돌아가기</button>
      </header>

      <section className="promo-intro">
        <div>
          <span className="promo-eyebrow">SCENE 06 · 홍보물 만들기</span>
          <h1>입력한 생활정보가<br />홍보물로 정돈됩니다.</h1>
          <p>주민이 입력한 이름·하는 일·혜택·대표사진을 필요한 홍보 형식에 맞게 편집해 보여줍니다. 프롬프트나 로봇 연출 없이 실제 등록정보가 어떻게 쓰이는지 바로 확인합니다.</p>
        </div>
        <aside className="promo-source-card">
          <span>현재 등록정보</span>
          <strong>{application.businessName} · {statusLabel(application)}</strong>
          <p>{application.serviceSummary}</p>
          <dl>
            <div><dt>분야</dt><dd>{application.categoryName}</dd></div>
            <div><dt>주민혜택</dt><dd>{displayBenefit(application)}</dd></div>
            <div><dt>주민관계</dt><dd>{relationLabels[application.relationType]}</dd></div>
            <div><dt>대표사진</dt><dd>{application.representativeImageObjectKey ? (previewUrl ? '등록 사진 연결됨' : '등록 사진 참조') : '기본 작업장면 사용'}</dd></div>
          </dl>
          <button className="promo-create" type="button" onClick={buildMaterials} disabled={building || builtCount === 3}>
            {building ? `홍보물 정돈 중 · ${builtCount}/3` : builtCount === 3 ? '홍보물 3종 완성' : '홍보물 만들기'}
          </button>
        </aside>
      </section>

      <section className="promo-output-grid" aria-label="홍보물 결과">
        <WaitingOutput label="단지온 가게소개 카드" index={1} built={builtCount >= 1}>
          <ListingCard application={application} previewUrl={previewUrl} />
        </WaitingOutput>
        <WaitingOutput label="카카오톡 공유 이미지" index={2} built={builtCount >= 2}>
          <KakaoCard application={application} previewUrl={previewUrl} />
        </WaitingOutput>
        <WaitingOutput label="엘리베이터 게시판 포스터" index={3} built={builtCount >= 3}>
          <ElevatorPoster application={application} previewUrl={previewUrl} />
        </WaitingOutput>
      </section>

      <section className="promo-note">
        <strong>현재 단계</strong>
        <p>현장시연 기준과 동일하게 브라우저 DOM 미리보기 3종을 생성합니다. 실제 PNG/JPG 내보내기와 공유 전송은 배포 인프라 연결 이후 별도 기능으로 붙일 수 있도록 출력물을 독립 영역으로 분리했습니다.</p>
      </section>
    </main>
  );
}
