import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import DemoControlPage from './DemoControlPage';

createRoot(document.getElementById('demo-root')!).render(
  <StrictMode>
    <DemoControlPage />
  </StrictMode>
);
