import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installDemoServiceWorker } from './demo-service-worker';
import { installDemoSessionTracking } from './demo-state';
import OperationsReviewPage from './OperationsReviewPage';
import './operations-review.css';

createRoot(document.getElementById('operations-review-root')!).render(
  <StrictMode>
    <OperationsReviewPage />
  </StrictMode>
);

installDemoSessionTracking('운영확인·승인');
void installDemoServiceWorker();
