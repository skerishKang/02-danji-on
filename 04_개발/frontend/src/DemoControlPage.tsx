import { useEffect, useMemo, useState } from 'react';
import { installDemoServiceWorker } from './demo-service-worker';
import { prepareFieldDemo, readDemoSession, startFieldDemo, type DemoSession } from './demo-state';
import './demo-console.css';

const statusLabels: Record<DemoSession['status'], string> = {
  idle: '준비 전',
  ready: '시연 준비 완료',
  running: '시연 진행 중',
  complete: '시연 완료'
};

const detailStatusLabels: Record<DemoSession['status'], string> = {
  idle: '준비 전',
  ready: '준비됨',
  running: '진행 중',
  complete: '완료'
};

function formatTime(value: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);
}

export default function DemoControlPage() {
  const [session, setSession] = useState(() => readDemoSession());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [online, setOnline] = useState(() => navigator.onLine);
  const [swReady, setSwReady] = useState(false);

  useEffect(() => {
    const refresh = () => setSession(readDemoSession());
    const onlineListener = () => setOnline(true);
    const offlineListener = () => setOnline(false);
    window.addEventListener('danjion:demo-session-changed', refresh);
    window.addEventListener('online', onlineListener);
    window.addEventListener('offline', offlineListener);
    void installDemoServiceWorker().then((registration) => setSwReady(Boolean(registration)));
    return () => {
      window.removeEventListener('danjion:demo-session-changed', refresh);
      window.removeEventListener('online', onlineListener);
      window.removeEventListener('offline', offlineListener);
    };
  }, []);

  const canResume = session.status === 'running' && session.lastUrl && session.lastUrl !== '/demo.html';
  const health = useMemo(() => [
    { label: '데이터 모드', value: import.meta.env.VITE_DATA_MODE === 'api' ? '실 API' : 'Mock 시연' },
    { label: '네트워크', value: online ? '온라인' : '오프라인' },
    { label: '오프라인 앱 shell', value: swReady ? '준비됨' : '준비 중' },
    { label: '마지막 화면', value: session.lastSurface || '-' }
  ], [online, session.lastSurface, swReady]);

  async function prepare() {
    setBusy(true);
    setMessage('');
    try {
      const next = await prepareFieldDemo();
      setSession(next);
      setMessage('시연 데이터를 기준 상태로 초기화했습니다. 신청·혜택·검토이력·인증·업로드 임시파일이 정리됐습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '시연 준비 초기화에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    setMessage('');
    try {
      await installDemoServiceWorker();
      await startFieldDemo();
      window.location.assign('/?demo=1');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '시연 시작에 실패했습니다.');
      setBusy(false);
    }
  }

  function resume() {
    window.location.assign(session.lastUrl || '/?demo=1');
  }

  return (
    <main className="demo-console-shell">
      <section className="demo-console-hero">
        <span className="demo-console-kicker">FIELD DEMO CONTROL</span>
        <h1>단지온 현장시연 콘솔</h1>
        <p>시연을 같은 기준상태에서 시작하고, 중간에 새로고침하거나 화면을 벗어나도 마지막 지점으로 복구합니다.</p>
        <div className={`demo-status-badge status-${session.status}`}>{statusLabels[session.status]}</div>
      </section>

      <section className="demo-console-actions" aria-label="시연 제어">
        <button type="button" className="demo-action secondary" disabled={busy} onClick={() => void prepare()}>
          {busy ? '처리 중...' : '1. 시연 준비 초기화'}
        </button>
        <button type="button" className="demo-action primary" disabled={busy} onClick={() => void start()}>
          2. 시연 시작
        </button>
        <button type="button" className="demo-action recovery" disabled={!canResume || busy} onClick={resume}>
          마지막 지점으로 복구
        </button>
      </section>

      {message && <p className="demo-console-message" role="status">{message}</p>}
      {session.lastError && <p className="demo-console-error" role="alert">마지막 오류: {session.lastError}</p>}

      <section className="demo-console-grid">
        <article>
          <h2>현재 상태</h2>
          <dl>
            <div><dt>상태</dt><dd>{detailStatusLabels[session.status]}</dd></div>
            <div><dt>준비 시각</dt><dd>{formatTime(session.preparedAt)}</dd></div>
            <div><dt>시작 시각</dt><dd>{formatTime(session.startedAt)}</dd></div>
            <div><dt>Run ID</dt><dd>{session.runId || '-'}</dd></div>
          </dl>
        </article>
        <article>
          <h2>복구 정보</h2>
          <dl>
            {health.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
            <div><dt>복구 URL</dt><dd><code>{session.lastUrl}</code></dd></div>
          </dl>
        </article>
      </section>

      <section className="demo-console-baseline">
        <h2>초기화 기준</h2>
        <div className="demo-baseline-list">
          <span>사업자 신청 fixture 3건</span>
          <span>받은 주민혜택 0건</span>
          <span>추가 공지·혜택 0건</span>
          <span>개발 주민 인증 완료</span>
          <span>검토이력 기준 fixture</span>
          <span>Mock 업로드 DB 비움</span>
        </div>
        <p>이 콘솔은 Mock 현장시연 전용입니다. 실제 API/운영 데이터는 자동 초기화하지 않습니다.</p>
      </section>
    </main>
  );
}
