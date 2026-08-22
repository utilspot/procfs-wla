import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SchedStatApp } from '../SchedStatApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from schedstat.html');

createRoot(container).render(
  <StrictMode>
    <SchedStatApp />
  </StrictMode>,
);
