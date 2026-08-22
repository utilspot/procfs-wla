import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ZoneInfoApp } from '../ZoneInfoApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from zoneinfo.html');

createRoot(container).render(
  <StrictMode>
    <ZoneInfoApp />
  </StrictMode>,
);
