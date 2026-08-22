import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DiskstatsApp } from '../DiskstatsApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from diskstats.html');

createRoot(container).render(
  <StrictMode>
    <DiskstatsApp />
  </StrictMode>,
);
