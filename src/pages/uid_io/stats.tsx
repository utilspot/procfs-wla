import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { UidIoStatsApp } from '../../UidIoStatsApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from uid_io/stats.html');

createRoot(container).render(
  <StrictMode>
    <UidIoStatsApp />
  </StrictMode>,
);
