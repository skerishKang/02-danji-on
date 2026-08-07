import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AdminVerificationApp from './AdminVerificationApp';
import './verification.css';

createRoot(document.getElementById('root')!).render(<StrictMode><AdminVerificationApp /></StrictMode>);
