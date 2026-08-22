import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AsoundTimersApp } from '../../AsoundTimersApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from asound/timers.html');

createRoot(container).render(
  <StrictMode>
    <AsoundTimersApp />
  </StrictMode>,
);
