import { useEffect, useRef, useState } from 'react';

type JoinMethod = 'phone' | 'google';
type Relation = 'spouse' | 'parent' | 'adult-child' | 'other';
type OnboardingPhase = 'join' | 'family';

const RELATIONS: Array<{ key: Relation; label: string }> = [
  { key: 'spouse', label: '배우자' },
  { key: 'parent', label: '부모' },
  { key: 'adult-child', label: '성인자녀' },
  { key: 'other', label: '기타 가족' }
];

function Brand({ complexName, step }: { complexName: string; step: string }) {
  return (
    <div className="v2-onboarding-top">
      <div className="v2-onboarding-brand"><strong>DANJION</strong><small>by PADIEM</small></div>
      <span>{complexName} · {step}</span>
    </div>
  );
}

function Choice({
  selected,
  icon,
  title,
  detail,
  onClick
}: {
  selected?: boolean;
  icon: string;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={selected ? 'v2-onboarding-choice is-selected' : 'v2-onboarding-choice'} onClick={onClick} aria-pressed={selected}>
      <span className="v2-onboarding-choice-icon" aria-hidden="true">{icon}</span>
      <span><strong>{title}</strong><small>{detail}</small></span>
    </button>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="v2-onboarding-notice">{children}</div>;
}

export function V2Gate1Onboarding({
  open,
  complexName = '방림명지로드힐',
  onClose,
  onFinish
}: {
  open: boolean;
  complexName?: string;
  onClose: () => void;
  onFinish?: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [phase, setPhase] = useState<OnboardingPhase>('join');
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [method, setMethod] = useState<JoinMethod>('phone');
  const [serviceNotice, setServiceNotice] = useState(false);
  const [benefitNotice, setBenefitNotice] = useState(false);
  const [building, setBuilding] = useState('102');
  const [unit, setUnit] = useState('1802');
  const [relation, setRelation] = useState<Relation>('spouse');

  useEffect(() => {
    if (!open) return;
    setPhase('join');
    setStep(1);
    closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  function nextJoin() {
    if (step < 4) setStep((step + 1) as 1 | 2 | 3 | 4);
    else {
      setPhase('family');
      setStep(1);
    }
  }

  function back() {
    if (step > 1) {
      setStep((step - 1) as 1 | 2 | 3 | 4);
      return;
    }
    if (phase === 'family') {
      setPhase('join');
      setStep(4);
    }
  }

  function finish() {
    onClose();
    onFinish?.();
  }

  const stepLabel = phase === 'join' ? `${step} / 4` : '우리집 가족';

  return (
    <div className="v2-onboarding-backdrop" data-v2-onboarding data-phase={phase} data-step={step} onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="v2-onboarding-shell" role="dialog" aria-modal="true" aria-labelledby="v2-onboarding-title">
        <button ref={closeRef} type="button" className="v2-onboarding-close" onClick={onClose} aria-label="가입 화면 닫기">닫기</button>
        <Brand complexName={complexName} step={stepLabel} />

        <div className="v2-onboarding-body">
          {phase === 'join' && step === 1 && (
            <>
              <div className="v2-onboarding-kicker">{complexName} 단지온</div>
              <h2 id="v2-onboarding-title">어떻게 시작할까요?</h2>
              <p>본인에게 편한 방법을 선택해 주세요. 지금은 React UI만 완성한 상태이며 실제 로그인 연결은 하지 않습니다.</p>
              <Choice selected={method === 'phone'} icon="☎" title="휴대전화로 시작하기" detail="본인 휴대전화로 확인" onClick={() => setMethod('phone')} />
              <Choice selected={method === 'google'} icon="G" title="Google로 시작하기" detail="Google 계정으로 간편하게" onClick={() => setMethod('google')} />
              <Notice>관리사무소의 입주자명부·전화번호를 단지온이 받아 일괄 가입시키지 않습니다.</Notice>
            </>
          )}

          {phase === 'join' && step === 2 && (
            <>
              <div className="v2-onboarding-kicker">이용 동의</div>
              <h2 id="v2-onboarding-title">필요한 내용만<br />정확히 동의받습니다.</h2>
              <p>선택항목은 동의하지 않아도 다음 화면으로 갈 수 있습니다.</p>
              <div className="v2-onboarding-checklist">
                <div className="v2-onboarding-check is-required"><span>✓</span><div><strong>단지온 이용약관</strong><small>필수</small></div><button type="button">내용 보기</button></div>
                <div className="v2-onboarding-check is-required"><span>✓</span><div><strong>개인정보 수집·이용</strong><small>필수</small></div><button type="button">내용 보기</button></div>
                <label className="v2-onboarding-check"><input type="checkbox" checked={serviceNotice} onChange={(event) => setServiceNotice(event.target.checked)} /><div><strong>서비스 알림 수신</strong><small>선택 · 기본 OFF</small></div><button type="button">내용 보기</button></label>
                <label className="v2-onboarding-check"><input type="checkbox" checked={benefitNotice} onChange={(event) => setBenefitNotice(event.target.checked)} /><div><strong>혜택·이벤트 알림</strong><small>선택 · 기본 OFF</small></div><button type="button">내용 보기</button></label>
              </div>
            </>
          )}

          {phase === 'join' && step === 3 && (
            <>
              <div className="v2-onboarding-kicker">우리집 연결</div>
              <h2 id="v2-onboarding-title">살고 있는 동·호를<br />입력해 주세요.</h2>
              <div className="v2-onboarding-fixed-apt"><small>안내 링크로 선택된 아파트</small><strong>{complexName}</strong></div>
              <div className="v2-onboarding-unit-grid">
                <label>동<select value={building} onChange={(event) => setBuilding(event.target.value)}><option value="101">101동</option><option value="102">102동</option></select></label>
                <label>호<input inputMode="numeric" value={unit} maxLength={4} onChange={(event) => setUnit(event.target.value.replace(/\D/g, '').slice(0, 4))} /><span>호</span></label>
              </div>
              <Notice>동·호는 우리집 연결을 위한 정보이며 공개 프로필에는 표시되지 않습니다. 이 화면은 UI 시연일 뿐 주민 확인 상태를 만들지 않습니다.</Notice>
            </>
          )}

          {phase === 'join' && step === 4 && (
            <>
              <div className="v2-onboarding-kicker">입력 완료</div>
              <h2 id="v2-onboarding-title">우리집 정보가<br />입력되었습니다.</h2>
              <div className="v2-onboarding-status-card">
                <span className="v2-onboarding-status-icon">✓</span>
                <h3>동·호 입력 완료</h3>
                <p>{complexName} {building}동<br />입력한 호수는 다른 주민에게 보이지 않아요.</p>
                <b>입주민 확인 전</b>
              </div>
              <Notice>실제 주민 확인은 Neon 인증·DB 연결 단계에서 구현합니다. 지금 React 화면에서는 상태를 임의로 확정하지 않습니다.</Notice>
            </>
          )}

          {phase === 'family' && step === 1 && (
            <>
              <div className="v2-family-hero"><div className="v2-family-windows" aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <i key={index} />)}</div><div><small>한 집의 불이 더 켜집니다</small><strong>우리집 가족도<br />함께 연결할까요?</strong></div></div>
              <p>가족도 자기 계정으로 직접 가입하는 흐름을 보여주는 UI입니다.</p>
              <div className="v2-family-state"><span>나</span><div><strong>초대하는 사람</strong><small>계정 화면 완료 · 동·호 입력 완료</small></div></div>
            </>
          )}

          {phase === 'family' && step === 2 && (
            <>
              <div className="v2-onboarding-kicker">초대 링크</div>
              <h2 id="v2-onboarding-title">가족에게 편한 방법으로 보내세요.</h2>
              <p>실제 링크 발급은 아직 하지 않습니다. 공유 버튼의 React 상호작용과 화면만 완성합니다.</p>
              <div className="v2-family-share-list">
                <button type="button"><span>●</span>카카오로 공유</button>
                <button type="button"><span>✉</span>문자로 공유</button>
                <button type="button"><span>↗</span>링크 복사</button>
              </div>
              <div className="v2-family-ticket"><small>단지온 가족초대</small><strong>7일 동안 사용할 수 있어요</strong><span>링크에는 동·호를 표시하지 않습니다.</span></div>
            </>
          )}

          {phase === 'family' && step === 3 && (
            <>
              <div className="v2-onboarding-kicker">가족초대 화면</div>
              <h2 id="v2-onboarding-title">가족이 단지온으로<br />초대했습니다.</h2>
              <p>본인 계정으로 시작하고 가족 관계를 선택하는 화면입니다.</p>
              <Choice selected={method === 'phone'} icon="☎" title="휴대전화로 가입" detail="본인 휴대전화 확인" onClick={() => setMethod('phone')} />
              <Choice selected={method === 'google'} icon="G" title="Google로 가입" detail="Google 계정 사용" onClick={() => setMethod('google')} />
              <h3 className="v2-family-relation-title">초대한 가족과의 관계</h3>
              <div className="v2-family-relations">{RELATIONS.map((item) => <button type="button" key={item.key} className={relation === item.key ? 'is-active' : ''} onClick={() => setRelation(item.key)}>{item.label}</button>)}</div>
            </>
          )}

          {phase === 'family' && step === 4 && (
            <>
              <div className="v2-onboarding-kicker">우리집 연결 화면</div>
              <h2 id="v2-onboarding-title">가족 한 분이<br />연결되었습니다.</h2>
              <div className="v2-onboarding-status-card is-family"><span className="v2-onboarding-status-icon">✓</span><h3>가족 연결 UI 완료</h3><p>실제 계정·주민 상태는 아직 생성하지 않습니다.</p></div>
              <div className="v2-family-state"><span>김</span><div><strong>김○○ · {RELATIONS.find((item) => item.key === relation)?.label}</strong><small>React 화면 연결 완료</small></div></div>
              <div className="v2-family-state is-add"><span>+</span><div><strong>다른 가족 초대</strong><small>새 초대 화면 열기</small></div></div>
              <Notice>React UI 완성 단계와 실제 주민인증 단계는 분리합니다. Neon 연결 전에는 이 화면이 권한을 부여하지 않습니다.</Notice>
            </>
          )}
        </div>

        <div className="v2-onboarding-actions">
          {(step > 1 || phase === 'family') && <button type="button" className="v2-onboarding-secondary" onClick={back}>이전</button>}
          {phase === 'family' && step === 1 && <button type="button" className="v2-onboarding-secondary" onClick={finish}>나중에 하기</button>}
          {phase === 'join' && <button type="button" className="v2-onboarding-primary" onClick={nextJoin}>{step === 1 ? '다음' : step === 2 ? '필수항목 동의하고 다음' : step === 3 ? '동·호 입력 완료' : '가족초대로 이동'}</button>}
          {phase === 'family' && step < 4 && <button type="button" className="v2-onboarding-primary" onClick={() => setStep((step + 1) as 1 | 2 | 3 | 4)}>{step === 1 ? '가족 초대하기' : step === 2 ? '초대상태 보기' : '가입하고 가족 연결'}</button>}
          {phase === 'family' && step === 4 && <button type="button" className="v2-onboarding-primary" onClick={finish}>단지온 홈으로</button>}
        </div>
      </section>
    </div>
  );
}

export function V2Gate1ProjectStory({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);
  if (!open) return null;

  return (
    <div className="v2-project-story-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="v2-project-story" role="dialog" aria-modal="true" aria-labelledby="v2-project-story-title">
        <button ref={closeRef} type="button" className="v2-onboarding-close" onClick={onClose}>닫기</button>
        <header><div className="v2-onboarding-brand"><strong>DANJION</strong><small>by PADIEM</small></div><span>방림명지로드힐 · 단지온을 시작하며</span></header>
        <div className="v2-project-story-grid">
          <div><div className="v2-project-quote">“</div><h2 id="v2-project-story-title">같은 단지에 사는 이웃을<br />더 가깝게 연결하고 싶었습니다.</h2><div className="v2-project-sign"><strong>김경애</strong><span>제5기 입주자대표회의 회장</span></div></div>
          <div className="v2-project-message"><p>주민 여러분이 같은 단지에 사는 이웃의 일을 더 쉽게 발견하고, 우리 아파트 소식과 생활정보를 편하게 확인할 수 있으면 좋겠다는 생각에서 단지온 도입을 제안했습니다.</p><p>단지온은 가입을 강요하는 관리앱이 아니라 주민이 자유롭게 이용하는 생활편의 서비스입니다.</p></div>
        </div>
        <div className="v2-project-credits"><article><small>시작한 사람</small><strong>김경애 회장</strong><p>주민 생활편의와 이웃 생활경제를 위한 도입 제안</p></article><article><small>만든 팀</small><strong>PADIEM</strong><p>단지온의 기획·디자인·개발·편집·운영</p></article><article><small>초기 지원</small><strong>1년간 0원</strong><p>서비스 개시일부터 구축비·플랫폼 운영비 무상지원 계획</p></article></div>
        <div className="v2-project-disclosure"><p>PADIEM이 플랫폼 운영을 담당하며 관리사무소에 플랫폼 관리자 권한을 자동 부여하지 않습니다.</p><p>이 화면은 디자인 확정본의 도입·운영 설명을 React로 옮긴 것이며 실제 계약·운영 상태를 자동 확정하지 않습니다.</p></div>
      </section>
    </div>
  );
}
