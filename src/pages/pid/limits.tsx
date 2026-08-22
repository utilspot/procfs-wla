import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LimitsApp } from '../../LimitsApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from pid/limits.html');

createRoot(container).render(
  <StrictMode>
    <LimitsApp />
  </StrictMode>,
);
