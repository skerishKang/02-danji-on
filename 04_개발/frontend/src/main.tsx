import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installResidentAccessibilityEnhancements } from './accessibility-dom';
import './styles.css';
import './feature-flows.css';
import './accessibility.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

installResidentAccessibilityEnhancements();
