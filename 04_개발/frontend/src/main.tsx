import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installResidentAccessibilityEnhancements } from './accessibility-dom';
import { installPromoMaterialLaunchers } from './promo-launcher';
import { installResidentDeepLink } from './resident-deep-link';
import './styles.css';
import './feature-flows.css';
import './accessibility.css';
import './promo-materials.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

installResidentAccessibilityEnhancements();
installPromoMaterialLaunchers();
void installResidentDeepLink();
