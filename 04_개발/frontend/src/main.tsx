import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installResidentAccessibilityEnhancements } from './accessibility-dom';
import { installDemoServiceWorker } from './demo-service-worker';
import { installDemoSessionTracking } from './demo-state';
import { installPromoMaterialLaunchers } from './promo-launcher';
import { installResidentDeepLink } from './resident-deep-link';
import './styles.css';
import './feature-flows.css';
import './accessibility.css';
import './promo-materials.css';
import './cycle-completion.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

installDemoSessionTracking('주민 발견·내정보');
void installDemoServiceWorker();
installResidentAccessibilityEnhancements();
installPromoMaterialLaunchers();
void installResidentDeepLink();
