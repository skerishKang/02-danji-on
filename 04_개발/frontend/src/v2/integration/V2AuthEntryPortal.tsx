import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  completeVerifiedSignup,
  getProductApiBearerToken,
  signInWithEmail,
  signInWithPhone,
  signInWithSocial,
  signUpWithVerifiedSocial,
  startSignupPhoneVerification,
  verifySignupPhoneCode,
  type SocialLoginProvider
} from '../../auth-client';

type AccountMode = 'signup' | 'signin';
type DirectMethod = 'email' | 'phone';
type PhoneVerificationState = 'idle' | 'sent' | 'verified';

const LIVE_AUTH = import.meta.env.VITE_AUTH_MODE === 'danjion';
const VERIFICATION_PATH = '/verification.html';

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return '계정 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.';
}

export default function V2AuthEntryPortal() {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AccountMode>('signup');
  const [method, setMethod] = useState<DirectMethod>('email');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [signupSessionRef, setSignupSessionRef] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [verificationReceiptRef, setVerificationReceiptRef] = useState('');
  const [phoneVerificationState, setPhoneVerificationState] = useState<PhoneVerificationState>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    const resolveHost = () => {
      setHost(document.querySelector<HTMLElement>('[data-v2-topbar] .v2-header-tools'));
    };
    resolveHost();
    const observer = new MutationObserver(resolveHost);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!LIVE_AUTH) return;
    let cancelled = false;
    void getProductApiBearerToken()
      .then((token) => {
        if (!cancelled) setAuthenticated(Boolean(token));
      })
      .catch(() => {
        if (!cancelled) setAuthenticated(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function resetPhoneVerification() {
    setOtpCode('');
    setSignupSessionRef('');
    setChallengeId('');
    setVerificationReceiptRef('');
    setPhoneVerificationState('idle');
  }

  function openDialog(nextMode: AccountMode = 'signup') {
    setMode(nextMode);
    setError('');
    if (nextMode === 'signup') resetPhoneVerification();
    setOpen(true);
  }

  function switchMode(nextMode: AccountMode) {
    setMode(nextMode);
    setError('');
    resetPhoneVerification();
  }

  async function social(provider: SocialLoginProvider) {
    setError('');
    if (!LIVE_AUTH) {
      setError('개발 미리보기에서는 실제 소셜 계정을 만들거나 로그인하지 않습니다.');
      return;
    }
    if (mode === 'signup' && (!verificationReceiptRef || phoneVerificationState !== 'verified')) {
      setError('소셜 가입도 휴대폰 인증을 먼저 완료해 주세요.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signup') {
        await signUpWithVerifiedSocial(provider, {
          signupSessionRef,
          verificationReceiptRef
        });
      } else {
        await signInWithSocial(provider);
      }
    } catch (requestError) {
      setError(errorMessage(requestError));
      setBusy(false);
    }
  }

  async function sendVerificationCode() {
    setError('');
    if (!LIVE_AUTH) {
      setError('개발 미리보기에서는 실제 인증번호를 전송하지 않습니다.');
      return;
    }
    if (!email.trim() || !phone.trim()) {
      setError('이메일과 휴대폰 번호를 먼저 입력해 주세요.');
      return;
    }
    setBusy(true);
    try {
      const result = await startSignupPhoneVerification({
        email,
        phone,
        signupSessionRef: signupSessionRef || undefined
      });
      setSignupSessionRef(result.signupSessionRef);
      setChallengeId(result.challengeId);
      setOtpCode('');
      setVerificationReceiptRef('');
      setPhoneVerificationState('sent');
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function confirmVerificationCode() {
    setError('');
    if (!signupSessionRef || !challengeId) {
      setError('먼저 인증번호를 받아 주세요.');
      return;
    }
    if (!/^\d{6}$/.test(otpCode.trim())) {
      setError('6자리 인증번호를 입력해 주세요.');
      return;
    }
    setBusy(true);
    try {
      const result = await verifySignupPhoneCode({
        signupSessionRef,
        challengeId,
        code: otpCode.trim()
      });
      setVerificationReceiptRef(result.verificationReceiptRef);
      setPhoneVerificationState('verified');
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');

    if (!LIVE_AUTH) {
      setError('현재 화면은 개발 미리보기입니다. 실제 회원가입은 live auth 배포에서만 실행합니다.');
      return;
    }

    if (mode === 'signup') {
      if (!name.trim()) {
        setError('이름 또는 닉네임을 입력해 주세요.');
        return;
      }
      if (!email.trim()) {
        setError('계정 확인과 복구를 위해 이메일은 필수입니다.');
        return;
      }
      if (!phone.trim()) {
        setError('휴대폰 번호를 입력해 주세요.');
        return;
      }
      if (!verificationReceiptRef || phoneVerificationState !== 'verified') {
        setError('휴대폰 인증을 먼저 완료해 주세요.');
        return;
      }
      if (password.length < 8) {
        setError('비밀번호는 8자 이상 입력해 주세요.');
        return;
      }
    } else {
      if (method === 'email' && !email.trim()) {
        setError('이메일을 입력해 주세요.');
        return;
      }
      if (method === 'phone' && !phone.trim()) {
        setError('휴대폰 번호를 입력해 주세요.');
        return;
      }
      if (!password) {
        setError('비밀번호를 입력해 주세요.');
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === 'signup') {
        await completeVerifiedSignup({
          email,
          name,
          phone,
          password,
          signupSessionRef,
          verificationReceiptRef
        });
        return;
      }

      if (method === 'phone') await signInWithPhone(phone, password);
      else await signInWithEmail(email, password);

      window.location.assign(VERIFICATION_PATH);
    } catch (requestError) {
      setError(errorMessage(requestError));
      setBusy(false);
    }
  }

  const launcher = host ? createPortal(
    authenticated ? (
      <button className="v2-gate1-announce" type="button" onClick={() => window.location.assign(VERIFICATION_PATH)}>
        입주민 확인
      </button>
    ) : (
      <button className="v2-gate1-announce" type="button" onClick={() => openDialog('signup')}>
        가입·로그인
      </button>
    ),
    host
  ) : null;

  const dialog = open ? createPortal(
    <div className="v2-onboarding-backdrop" data-v2-auth-entry onMouseDown={(event) => {
      if (event.target === event.currentTarget) setOpen(false);
    }}>
      <section className="v2-onboarding-shell" role="dialog" aria-modal="true" aria-labelledby="v2-auth-entry-title">
        <button ref={closeRef} type="button" className="v2-onboarding-close" onClick={() => setOpen(false)} aria-label="가입·로그인 화면 닫기">닫기</button>
        <div className="v2-onboarding-top">
          <div className="v2-onboarding-brand"><strong>DANJION</strong><small>by PADIEM</small></div>
          <span>실제 계정</span>
        </div>

        <form onSubmit={(event) => void submit(event)}>
          <div className="v2-onboarding-body">
            <div className="v2-onboarding-kicker">ACCOUNT</div>
            <h2 id="v2-auth-entry-title">{mode === 'signup' ? '단지온 계정을 만들어요.' : '다시 만나서 반가워요.'}</h2>
            <p>{mode === 'signup'
              ? '이메일과 휴대폰 연락처를 확인한 뒤 계정을 만듭니다. 입주민 인증은 계정 가입과 별도로 진행됩니다.'
              : '로그인하면 입주민 확인 상태를 확인하거나 신청할 수 있습니다.'}</p>

            <div className="v2-auth-mode" role="group" aria-label="가입 또는 로그인 선택">
              <button type="button" className={mode === 'signup' ? 'is-active' : ''} onClick={() => switchMode('signup')}>처음 가입</button>
              <button type="button" className={mode === 'signin' ? 'is-active' : ''} onClick={() => switchMode('signin')}>이미 회원</button>
            </div>

            {mode === 'signin' && (
              <div className="v2-auth-mode" role="group" aria-label="이메일 또는 휴대폰 로그인 방식">
                <button type="button" className={method === 'email' ? 'is-active' : ''} onClick={() => { setMethod('email'); setError(''); }}>이메일</button>
                <button type="button" className={method === 'phone' ? 'is-active' : ''} onClick={() => { setMethod('phone'); setError(''); }}>휴대폰 번호</button>
              </div>
            )}

            <div className="v2-auth-fields">
              {mode === 'signup' && (
                <label><span>이름 또는 닉네임</span><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="단지온에서 사용할 이름" /></label>
              )}
              {(mode === 'signup' || method === 'email') && (
                <label><span>{mode === 'signup' ? '이메일 · 필수 확인/복구 수단' : '이메일'}</span><input type="email" value={email} onChange={(event) => { setEmail(event.target.value); if (mode === 'signup') resetPhoneVerification(); }} autoComplete="email" placeholder="name@example.com" /></label>
              )}
              {(mode === 'signup' || method === 'phone') && (
                <label><span>휴대폰 번호{mode === 'signup' ? ' · 필수 인증' : ''}</span><input inputMode="tel" value={phone} onChange={(event) => { setPhone(event.target.value); if (mode === 'signup') resetPhoneVerification(); }} autoComplete="tel" placeholder="010-1234-5678" /></label>
              )}

              {mode === 'signup' && (
                <>
                  <button type="button" className="v2-onboarding-secondary" disabled={busy || !email.trim() || !phone.trim() || phoneVerificationState === 'verified'} onClick={() => void sendVerificationCode()}>
                    {phoneVerificationState === 'sent' ? '인증번호 다시 받기' : phoneVerificationState === 'verified' ? '휴대폰 인증 완료' : '인증번호 받기'}
                  </button>
                  <label><span>인증번호 · 6자리</span><input inputMode="numeric" value={otpCode} onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="one-time-code" placeholder="000000" disabled={phoneVerificationState === 'idle' || phoneVerificationState === 'verified'} /></label>
                  <button type="button" className="v2-onboarding-secondary" disabled={busy || phoneVerificationState !== 'sent' || otpCode.length !== 6} onClick={() => void confirmVerificationCode()}>
                    인증 확인
                  </button>
                </>
              )}

              <label><span>비밀번호</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder="8자 이상" /></label>
            </div>

            {error && <div className="v2-auth-error" role="alert">{error}</div>}

            <div className="v2-onboarding-notice">
              {mode === 'signup'
                ? '휴대폰 인증은 해당 연락처를 사용할 수 있음을 확인하는 절차입니다. 법적 본인확인이나 입주민 인증을 대신하지 않습니다. 소셜 가입도 같은 휴대폰 인증 receipt를 서버에서 일회성으로 확인합니다.'
                : '계정 로그인과 입주민 권한은 분리되어 있습니다. 로그인 후 입주민 확인 단계로 이어집니다.'}
            </div>

            <div className="v2-auth-social" aria-label={mode === 'signup' ? '소셜 계정으로 가입' : '소셜 계정으로 로그인'}>
              <button type="button" disabled={busy || (mode === 'signup' && phoneVerificationState !== 'verified')} onClick={() => void social('kakao')}>{mode === 'signup' ? 'Kakao로 가입' : 'Kakao'}</button>
              <button type="button" disabled={busy || (mode === 'signup' && phoneVerificationState !== 'verified')} onClick={() => void social('naver')}>{mode === 'signup' ? 'Naver로 가입' : 'Naver'}</button>
              <button type="button" disabled={busy || (mode === 'signup' && phoneVerificationState !== 'verified')} onClick={() => void social('google')}>{mode === 'signup' ? 'Google로 가입' : 'Google'}</button>
            </div>

            {mode === 'signin' && <a href="/auth-recovery.html">비밀번호를 잊으셨나요?</a>}
          </div>

          <div className="v2-onboarding-actions">
            <button type="button" className="v2-onboarding-secondary" onClick={() => setOpen(false)}>취소</button>
            <button type="submit" className="v2-onboarding-primary" disabled={busy || (mode === 'signup' && phoneVerificationState !== 'verified')}>
              {busy ? '처리 중…' : mode === 'signup' ? '가입하기' : '로그인'}
            </button>
          </div>
        </form>
      </section>
    </div>,
    document.body
  ) : null;

  return <>{launcher}{dialog}</>;
}
