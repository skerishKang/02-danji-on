import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import EndingPage from './EndingPage';
import './ending.css';

createRoot(document.getElementById('ending-root')!).render(
  <StrictMode>
    <EndingPage />
  </StrictMode>
);
