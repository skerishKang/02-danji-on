import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  getProductApiBearerToken,
  signInWithEmail,
  signInWithPhone,
  signInWithSocial,
  signUpWithEmail,
  signUpWithPhone,
  type SocialLoginProvider
} from '../../auth-client';

type AccountMode = 'signup' | 'signin';
type DirectMethod = 'email' | 'phone';

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

  function openDialog(nextMode: AccountMode = 'signup') {
    setMode(nextMode);
    setError('');
    setOpen(true);
  }

  async function social(provider: SocialLoginProvider) {
    setError('');
    if (!LIVE_AUTH) {
      setError('개발 미리보기에서는 실제 소셜 계정을 만들거나 로그인하지 않습니다.');
      return;
    }
    setBusy(true);
    try {
      await signInWithSocial(provider);
    } catch (requestError) {
      setError(errorMessage(requestError));
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
      if (password.length < 8) {
        setError('비밀번호는 8자 이상 입력해 주세요.');
        return;
      }
      if (method === 'phone' && !phone.trim()) {
        setError('휴대폰 번호를 입력해 주세요.');
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
        if (method === 'phone') {
          await signUpWithPhone({ email, name, phone, password });
        } else {
          await signUpWithEmail({ email, name, password, phone: phone.trim() || undefined });
        }
        // signUpWithEmail/signUpWithPhone move to the existing check-email page.
        return;
      }

      if (method === 'phone') await signInWithPhone(phone, password);
      else await signInWithEmail(email, password);

      // Account authentication is intentionally separate from resident authority.
      // A successful login continues into the existing resident-verification surface.
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
              ? '계정 가입과 입주민 인증은 분리합니다. 먼저 안전하게 계정을 만든 뒤 주민 확인으로 이어집니다.'
              : '로그인하면 입주민 확인 상태를 확인하거나 신청할 수 있습니다.'}</p>

            <div className="v2-auth-mode" role="group" aria-label="가입 또는 로그인 선택">
              <button type="button" className={mode === 'signup' ? 'is-active' : ''} onClick={() => { setMode('signup'); setError(''); }}>처음 가입</button>
              <button type="button" className={mode === 'signin' ? 'is-active' : ''} onClick={() => { setMode('signin'); setError(''); }}>이미 회원</button>
            </div>

            <div className="v2-auth-mode" role="group" aria-label="이메일 또는 휴대폰 로그인 방식">
              <button type="button" className={method === 'email' ? 'is-active' : ''} onClick={() => { setMethod('email'); setError(''); }}>이메일</button>
              <button type="button" className={method === 'phone' ? 'is-active' : ''} onClick={() => { setMethod('phone'); setError(''); }}>휴대폰 번호</button>
            </div>

            <div className="v2-auth-fields">
              {mode === 'signup' && (
                <label><span>이름 또는 닉네임</span><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="단지온에서 사용할 이름" /></label>
              )}
              {(mode === 'signup' || method === 'email') && (
                <label><span>{mode === 'signup' ? '이메일 · 필수 확인/복구 수단' : '이메일'}</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="name@example.com" /></label>
              )}
              {(mode === 'signup' || method === 'phone') && (
                <label><span>{method === 'phone' ? '휴대폰 번호' : '휴대폰 번호 · 선택'}</span><input inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" placeholder="010-1234-5678" /></label>
              )}
              <label><span>비밀번호</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder="8자 이상" /></label>
            </div>

            {error && <div className="v2-auth-error" role="alert">{error}</div>}

            <div className="v2-onboarding-notice">
              이메일 가입 후 확인 링크를 눌러야 합니다. 휴대폰 번호는 로그인용 사용자명이며 SMS 인증이나 입주민 인증을 대신하지 않습니다.
            </div>

            <div className="v2-auth-social" aria-label="소셜 계정으로 계속하기">
              <button type="button" disabled={busy} onClick={() => void social('kakao')}>Kakao</button>
              <button type="button" disabled={busy} onClick={() => void social('naver')}>Naver</button>
              <button type="button" disabled={busy} onClick={() => void social('google')}>Google</button>
            </div>

            {mode === 'signin' && <a href="/auth-recovery.html">비밀번호를 잊으셨나요?</a>}
          </div>

          <div className="v2-onboarding-actions">
            <button type="button" className="v2-onboarding-secondary" onClick={() => setOpen(false)}>취소</button>
            <button type="submit" className="v2-onboarding-primary" disabled={busy}>{busy ? '처리 중…' : mode === 'signup' ? '계정 만들기' : '로그인'}</button>
          </div>
        </form>
      </section>
    </div>,
    document.body
  ) : null;

  return <>{launcher}{dialog}</>;
}
