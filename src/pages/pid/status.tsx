import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StatusApp } from '../../StatusApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from pid/status.html');

createRoot(container).render(
  <StrictMode>
    <StatusApp />
  </StrictMode>,
);
