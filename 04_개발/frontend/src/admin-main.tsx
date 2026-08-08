import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AdminApp from './AdminApp';
import { installDemoServiceWorker } from './demo-service-worker';
import { installDemoSessionTracking } from './demo-state';
import { installOperationsReviewLauncher } from './operations-review-launcher';
import './admin.css';
import './operations-review.css';

createRoot(document.getElementById('admin-root')!).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>
);

installDemoSessionTracking('운영관리');
void installDemoServiceWorker();
installOperationsReviewLauncher();
