import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installDemoServiceWorker } from './demo-service-worker';
import { installDemoSessionTracking, markDemoComplete, readDemoSession } from './demo-state';
import EndingPage from './EndingPage';
import './ending.css';

createRoot(document.getElementById('ending-root')!).render(
  <StrictMode>
    <EndingPage />
  </StrictMode>
);

installDemoSessionTracking('생활경제 엔딩');
void installDemoServiceWorker();
if (readDemoSession().status === 'running') markDemoComplete();
