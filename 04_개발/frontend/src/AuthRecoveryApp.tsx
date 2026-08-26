import { useMemo, useState, type FormEvent } from 'react';
import {
  requestPasswordReset,
  resendVerificationEmail,
  resetPasswordWithToken
} from './auth-client';

type RecoveryMode = 'reset-request' | 'verify-resend' | 'reset-token' | 'verified' | 'check-email';

const LIVE_AUTH = import.meta.env.VITE_AUTH_MODE === 'danjion';

function readInitialMode(): { mode: RecoveryMode; token: string; callbackError: string } {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token')?.trim() || '';
  const callbackError = params.get('error')?.trim() || '';
  if (params.get('mode') === 'verified') return { mode: 'verified', token, callbackError };
  if (params.get('mode') === 'check-email') return { mode: 'check-email', token, callbackError };
  if (token) return { mode: 'reset-token', token, callbackError };
  if (params.get('mode') === 'verify') return { mode: 'verify-resend', token, callbackError };
  return { mode: 'reset-request', token, callbackError };
}

function authErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

export default function AuthRecoveryApp() {
  const initial = useMemo(readInitialMode, []);
  const [mode, setMode] = useState<RecoveryMode>(initial.mode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(initial.callbackError ? '이메일 확인 링크가 만료되었거나 올바르지 않습니다.' : '');

  async function submitEmail(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!email.trim()) {
      setError('가입할 때 사용한 이메일을 입력해 주세요.');
      return;
    }
    if (!LIVE_AUTH) {
      setMessage('개발 미리보기에서는 실제 이메일을 보내지 않습니다.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'verify-resend' || mode === 'check-email') {
        await resendVerificationEmail(email);
        setMessage('확인 가능한 계정이라면 이메일 확인 링크를 보냈습니다. 메일함을 확인해 주세요.');
      } else {
        await requestPasswordReset(email);
        setMessage('확인 가능한 계정이라면 비밀번호 재설정 링크를 보냈습니다. 메일함을 확인해 주세요.');
      }
    } catch (requestError) {
      setError(authErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (password.length < 8) {
      setError('새 비밀번호는 8자 이상 입력해 주세요.');
      return;
    }
    if (password !== confirmPassword) {
      setError('새 비밀번호가 서로 일치하지 않습니다.');
      return;
    }
    if (!initial.token) {
      setError('비밀번호 재설정 토큰이 없습니다. 이메일의 링크를 다시 열어 주세요.');
      return;
    }
    if (!LIVE_AUTH) {
      setMessage('개발 미리보기에서는 실제 비밀번호를 변경하지 않습니다.');
      return;
    }

    setBusy(true);
    try {
      await resetPasswordWithToken(initial.token, password);
      setMessage('비밀번호가 변경되었습니다. 이제 새 비밀번호로 로그인할 수 있습니다.');
      setPassword('');
      setConfirmPassword('');
    } catch (requestError) {
      setError(authErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  const verified = mode === 'verified' && !initial.callbackError;
  const tokenMode = mode === 'reset-token';
  const verificationMode = mode === 'verify-resend' || mode === 'check-email';

  return (
    <main className="auth-recovery-page">
      <section className="auth-recovery-card" aria-labelledby="auth-recovery-title">
        <header>
          <a className="auth-recovery-brand" href="/" aria-label="단지온 홈">DANJION <small>by PADIEM</small></a>
          <span>계정 보호</span>
        </header>

        {verified ? (
          <div className="auth-recovery-result">
            <div className="auth-recovery-mark" aria-hidden="true">✓</div>
            <p className="auth-recovery-kicker">EMAIL VERIFIED</p>
            <h1 id="auth-recovery-title">이메일 확인이<br />완료되었습니다.</h1>
            <p>이 이메일은 단지온 계정의 복구 수단으로 사용할 수 있습니다. 휴대폰 번호 확인이나 입주민 인증과는 별개입니다.</p>
            <a className="auth-recovery-primary-link" href="/">단지온으로 돌아가기</a>
          </div>
        ) : tokenMode ? (
          <form onSubmit={submitPassword}>
            <p className="auth-recovery-kicker">RESET PASSWORD</p>
            <h1 id="auth-recovery-title">새 비밀번호를<br />정해 주세요.</h1>
            <p className="auth-recovery-lead">재설정이 완료되면 기존 다른 세션은 로그아웃됩니다.</p>
            <label>
              <span>새 비밀번호</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder="8자 이상" />
            </label>
            <label>
              <span>새 비밀번호 확인</span>
              <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" placeholder="한 번 더 입력" />
            </label>
            {error && <div className="auth-recovery-error" role="alert">{error}</div>}
            {message && <div className="auth-recovery-success" role="status">{message}</div>}
            <button className="auth-recovery-submit" type="submit" disabled={busy}>{busy ? '변경 중…' : '비밀번호 변경'}</button>
            <a className="auth-recovery-secondary-link" href="/">단지온 홈</a>
          </form>
        ) : (
          <form onSubmit={submitEmail}>
            <p className="auth-recovery-kicker">{mode === 'check-email' ? 'CHECK YOUR EMAIL' : 'ACCOUNT RECOVERY'}</p>
            <h1 id="auth-recovery-title">{mode === 'check-email'
              ? <>가입은 접수됐어요.<br />이메일을 확인해 주세요.</>
              : verificationMode
                ? <>이메일 확인 링크를<br />다시 보내드릴게요.</>
                : <>비밀번호를<br />잊으셨나요?</>}</h1>
            <p className="auth-recovery-lead">{mode === 'check-email'
              ? '가입할 때 입력한 이메일로 확인 링크를 보냈습니다. 링크를 누른 뒤 단지온에 로그인해 주세요. 메일이 오지 않았다면 아래에서 다시 받을 수 있습니다.'
              : verificationMode
                ? '가입할 때 등록한 이메일을 입력해 주세요.'
                : '단지온은 가입할 때 등록한 이메일로만 비밀번호 재설정 링크를 보냅니다.'}</p>

            <div className="auth-recovery-tabs" role="group" aria-label="계정 복구 방법">
              <button type="button" className={mode === 'reset-request' ? 'is-active' : ''} onClick={() => { setMode('reset-request'); setError(''); setMessage(''); }}>비밀번호 찾기</button>
              <button type="button" className={verificationMode ? 'is-active' : ''} onClick={() => { setMode('verify-resend'); setError(''); setMessage(''); }}>인증메일 다시 받기</button>
            </div>

            <label>
              <span>복구 이메일</span>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="name@example.com" />
            </label>
            {error && <div className="auth-recovery-error" role="alert">{error}</div>}
            {message && <div className="auth-recovery-success" role="status">{message}</div>}
            <button className="auth-recovery-submit" type="submit" disabled={busy}>{busy ? '보내는 중…' : verificationMode ? '확인 이메일 보내기' : '재설정 이메일 보내기'}</button>
            <div className="auth-recovery-note">보안을 위해 계정 존재 여부는 화면에서 구분해 알려드리지 않습니다.</div>
            <a className="auth-recovery-secondary-link" href="/">단지온 홈으로 돌아가기</a>
          </form>
        )}

        {!LIVE_AUTH && <footer>현재 화면은 개발 미리보기입니다. 실제 메일 발송과 비밀번호 변경은 하지 않습니다.</footer>}
      </section>
    </main>
  );
}
