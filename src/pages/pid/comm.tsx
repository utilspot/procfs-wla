import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CommApp } from '../../CommApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from pid/comm.html');

createRoot(container).render(
  <StrictMode>
    <CommApp />
  </StrictMode>,
);
