import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CryptoApp } from '../CryptoApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from crypto.html');

createRoot(container).render(
  <StrictMode>
    <CryptoApp />
  </StrictMode>,
);
