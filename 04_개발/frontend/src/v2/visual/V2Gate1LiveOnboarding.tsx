import { useEffect, useRef, useState } from 'react';
import {
  signInWithEmail,
  signInWithPhone,
  signInWithSocial,
  signUpWithEmail,
  signUpWithPhone,
  type SocialLoginProvider
} from '../../auth-client';

type JoinMethod = 'phone' | 'email' | SocialLoginProvider;
type AccountMode = 'signup' | 'signin';
type Relation = 'spouse' | 'parent' | 'adult-child' | 'other';
type OnboardingPhase = 'join' | 'family';

const LIVE_AUTH = import.meta.env.VITE_AUTH_MODE === 'danjion';
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

function Choice({ selected, icon, title, detail, onClick }: {
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

function AccountChoices({ method, onChange, compact = false }: {
  method: JoinMethod;
  onChange: (method: JoinMethod) => void;
  compact?: boolean;
}) {
  return (
    <>
      <Choice selected={method === 'kakao'} icon="K" title="카카오로 계속하기" detail="카카오 계정을 같은 단지온 계정에 연결" onClick={() => onChange('kakao')} />
      <Choice selected={method === 'naver'} icon="N" title="네이버로 계속하기" detail="네이버 계정을 같은 단지온 계정에 연결" onClick={() => onChange('naver')} />
      <Choice selected={method === 'google'} icon="G" title="Google로 계속하기" detail="Google 계정을 같은 단지온 계정에 연결" onClick={() => onChange('google')} />
      <Choice selected={method === 'phone'} icon="☎" title={compact ? '휴대폰 번호로 가입' : '휴대폰 번호로 시작하기'} detail="휴대폰 번호 + 비밀번호 · SMS 인증 없음" onClick={() => onChange('phone')} />
      <Choice selected={method === 'email'} icon="@" title={compact ? '이메일로 가입' : '이메일로 시작하기'} detail="이메일 + 비밀번호 · 계정 복구 기준" onClick={() => onChange('email')} />
    </>
  );
}

function DirectAccountForm({
  method,
  mode,
  name,
  email,
  phone,
  password,
  onName,
  onEmail,
  onPhone,
  onPassword
}: {
  method: 'phone' | 'email';
  mode: AccountMode;
  name: string;
  email: string;
  phone: string;
  password: string;
  onName: (value: string) => void;
  onEmail: (value: string) => void;
  onPhone: (value: string) => void;
  onPassword: (value: string) => void;
}) {
  const signup = mode === 'signup';
  return (
    <div className="v2-auth-fields" data-account-form={method}>
      {signup && (
        <label>
          <span>이름 또는 닉네임</span>
          <input value={name} onChange={(event) => onName(event.target.value)} autoComplete="name" placeholder="단지온에서 사용할 이름" />
        </label>
      )}
      {(signup || method === 'email') && (
        <label>
          <span>{signup ? '이메일 · 필수 복구수단' : '이메일'}</span>
          <input type="email" value={email} onChange={(event) => onEmail(event.target.value)} autoComplete="email" placeholder="name@example.com" />
        </label>
      )}
      {(signup || method === 'phone') && (
        <label>
          <span>{method === 'phone' ? '휴대폰 번호' : '휴대폰 번호 · 선택'}</span>
          <input inputMode="tel" value={phone} onChange={(event) => onPhone(event.target.value)} autoComplete="tel" placeholder="010-1234-5678" />
          {signup && method === 'email' && <small>등록하면 다음 로그인부터 휴대폰 번호 + 비밀번호도 사용할 수 있습니다.</small>}
        </label>
      )}
      <label>
        <span>비밀번호</span>
        <input type="password" value={password} onChange={(event) => onPassword(event.target.value)} autoComplete={signup ? 'new-password' : 'current-password'} placeholder="8자 이상" />
      </label>
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return '계정 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.';
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
  const [accountMode, setAccountMode] = useState<AccountMode>('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [accountReady, setAccountReady] = useState(false);
  const [serviceNotice, setServiceNotice] = useState(false);
  const [benefitNotice, setBenefitNotice] = useState(false);
  const [building, setBuilding] = useState('102');
  const [unit, setUnit] = useState('1802');
  const [relation, setRelation] = useState<Relation>('spouse');

  useEffect(() => {
    if (!open) return;
    setPhase('join');
    setStep(1);
    setAccountError('');
    setAccountReady(false);
    closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  if (!open) return null;

  async function selectMethod(nextMethod: JoinMethod) {
    setMethod(nextMethod);
    setAccountError('');
    setAccountReady(false);
    if (!LIVE_AUTH || nextMethod === 'phone' || nextMethod === 'email') return;

    setAccountBusy(true);
    try {
      await signInWithSocial(nextMethod);
    } catch (error) {
      setAccountError(errorMessage(error));
      setAccountBusy(false);
    }
  }

  async function completeAccountStep() {
    if (!LIVE_AUTH) {
      setAccountReady(true);
      setStep(2);
      return;
    }

    if (method === 'kakao' || method === 'naver' || method === 'google') {
      setAccountBusy(true);
      setAccountError('');
      try {
        await signInWithSocial(method);
      } catch (error) {
        setAccountError(errorMessage(error));
        setAccountBusy(false);
      }
      return;
    }

    setAccountBusy(true);
    setAccountError('');
    try {
      if (accountMode === 'signup') {
        if (!email.trim()) throw new Error('계정 복구를 위해 이메일은 필수입니다.');
        if (!name.trim()) throw new Error('이름 또는 닉네임을 입력해 주세요.');
        if (password.length < 8) throw new Error('비밀번호는 8자 이상 입력해 주세요.');
        if (method === 'phone') {
          if (!phone.trim()) throw new Error('휴대폰 번호를 입력해 주세요.');
          await signUpWithPhone({ email, name, phone, password });
        } else {
          await signUpWithEmail({ email, name, password, phone: phone.trim() || undefined });
        }
      } else if (method === 'phone') {
        await signInWithPhone(phone, password);
      } else {
        await signInWithEmail(email, password);
      }
      setAccountReady(true);
      setStep(2);
    } catch (error) {
      setAccountError(errorMessage(error));
    } finally {
      setAccountBusy(false);
    }
  }

  function nextJoin() {
    if (step === 1) {
      void completeAccountStep();
      return;
    }
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
  const directMethod = method === 'phone' || method === 'email';

  return (
    <div className="v2-onboarding-backdrop" data-v2-onboarding data-phase={phase} data-step={step} data-auth-live={LIVE_AUTH ? 'true' : 'false'} onMouseDown={(event) => {
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
              <p>카카오·네이버·Google 또는 이메일·휴대폰 번호 중 편한 방법으로 같은 단지온 계정에 들어옵니다.</p>
              <div className="v2-auth-mode" role="group" aria-label="가입 또는 로그인 선택">
                <button type="button" className={accountMode === 'signup' ? 'is-active' : ''} onClick={() => setAccountMode('signup')}>처음 가입</button>
                <button type="button" className={accountMode === 'signin' ? 'is-active' : ''} onClick={() => setAccountMode('signin')}>이미 회원</button>
              </div>
              <AccountChoices method={method} onChange={(value) => { void selectMethod(value); }} />
              {directMethod && (
                <DirectAccountForm
                  method={method}
                  mode={accountMode}
                  name={name}
                  email={email}
                  phone={phone}
                  password={password}
                  onName={setName}
                  onEmail={setEmail}
                  onPhone={setPhone}
                  onPassword={setPassword}
                />
              )}
              {accountError && <div className="v2-auth-error" role="alert">{accountError}</div>}
              {accountReady && <div className="v2-auth-success" role="status">계정 단계가 완료되었습니다.</div>}
              <Notice>이메일은 계정 복구의 기준입니다. 휴대폰 번호 로그인에는 SMS 인증을 사용하지 않으며, 휴대폰 번호 확인과 주민 확인은 별도 절차입니다.</Notice>
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
              <Notice>동·호는 우리집 연결을 위한 정보이며 공개 프로필에는 표시되지 않습니다. 입력만으로 주민 권한이 생기지 않습니다.</Notice>
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
              <Notice>계정 로그인과 주민 확인은 분리합니다. 주민 확인 방식은 관리소 승인·세대코드·향후 외부 provider 중에서 별도로 확정합니다.</Notice>
            </>
          )}

          {phase === 'family' && step === 1 && (
            <>
              <div className="v2-family-hero"><div className="v2-family-windows" aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <i key={index} />)}</div><div><small>한 집의 불이 더 켜집니다</small><strong>우리집 가족도<br />함께 연결할까요?</strong></div></div>
              <p>가족도 자기 계정으로 직접 가입하고, 주민 연결은 별도 검증 절차를 거칩니다.</p>
              <div className="v2-family-state"><span>나</span><div><strong>초대하는 사람</strong><small>계정 단계 완료 · 동·호 입력 완료</small></div></div>
            </>
          )}

          {phase === 'family' && step === 2 && (
            <>
              <div className="v2-onboarding-kicker">초대 링크</div>
              <h2 id="v2-onboarding-title">가족에게 편한 방법으로 보내세요.</h2>
              <p>실제 가족 초대 토큰 발급은 주민인증 정책 확정 뒤 연결합니다.</p>
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
              <p>본인 계정으로 시작하고 가족 관계를 선택합니다.</p>
              <AccountChoices method={method} onChange={(value) => setMethod(value)} compact />
              <h3 className="v2-family-relation-title">초대한 가족과의 관계</h3>
              <div className="v2-family-relations">{RELATIONS.map((item) => <button type="button" key={item.key} className={relation === item.key ? 'is-active' : ''} onClick={() => setRelation(item.key)}>{item.label}</button>)}</div>
            </>
          )}

          {phase === 'family' && step === 4 && (
            <>
              <div className="v2-onboarding-kicker">우리집 연결 화면</div>
              <h2 id="v2-onboarding-title">가족 한 분이<br />연결되었습니다.</h2>
              <div className="v2-onboarding-status-card is-family"><span className="v2-onboarding-status-icon">✓</span><h3>가족 연결 UI 완료</h3><p>실제 주민 권한은 아직 부여하지 않습니다.</p></div>
              <div className="v2-family-state"><span>김</span><div><strong>김○○ · {RELATIONS.find((item) => item.key === relation)?.label}</strong><small>계정과 주민 권한 분리 유지</small></div></div>
              <Notice>가족 계정 생성과 세대 주민인증은 별개입니다. 주민인증 provider가 확정되기 전까지 VERIFIED_RESIDENT를 만들지 않습니다.</Notice>
            </>
          )}
        </div>

        <div className="v2-onboarding-actions">
          {(step > 1 || phase === 'family') && <button type="button" className="v2-onboarding-secondary" onClick={back}>이전</button>}
          {phase === 'family' && step === 1 && <button type="button" className="v2-onboarding-secondary" onClick={finish}>나중에 하기</button>}
          {phase === 'join' && (
            <button type="button" className="v2-onboarding-primary" disabled={accountBusy} onClick={nextJoin}>
              {step === 1
                ? accountBusy
                  ? '계정 연결 중…'
                  : LIVE_AUTH && directMethod
                    ? accountMode === 'signup' ? '계정 만들고 다음' : '로그인하고 다음'
                    : LIVE_AUTH ? '소셜 로그인 계속' : '다음'
                : step === 2 ? '필수항목 동의하고 다음' : step === 3 ? '동·호 입력 완료' : '가족초대로 이동'}
            </button>
          )}
          {phase === 'family' && step < 4 && <button type="button" className="v2-onboarding-primary" onClick={() => setStep((step + 1) as 1 | 2 | 3 | 4)}>{step === 1 ? '가족 초대하기' : step === 2 ? '초대상태 보기' : '가입하고 가족 연결'}</button>}
          {phase === 'family' && step === 4 && <button type="button" className="v2-onboarding-primary" onClick={finish}>단지온 홈으로</button>}
        </div>
      </section>
    </div>
  );
}
