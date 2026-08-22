import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PidMountsApp } from '../../PidMountsApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from pid/mounts.html');

createRoot(container).render(
  <StrictMode>
    <PidMountsApp />
  </StrictMode>,
);
