import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installDemoServiceWorker } from './demo-service-worker';
import { installDemoSessionTracking } from './demo-state';
import PromoMaterialsPage from './PromoMaterialsPage';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PromoMaterialsPage />
  </StrictMode>
);

installDemoSessionTracking('홍보물 3종');
void installDemoServiceWorker();
