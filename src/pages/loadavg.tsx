import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LoadAvgApp } from '../LoadAvgApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from loadavg.html');

createRoot(container).render(
  <StrictMode>
    <LoadAvgApp />
  </StrictMode>,
);
