import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { UptimeApp } from '../UptimeApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from uptime.html');

createRoot(container).render(
  <StrictMode>
    <UptimeApp />
  </StrictMode>,
);
