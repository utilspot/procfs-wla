import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PidSchedStatApp } from '../../PidSchedStatApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from pid/schedstat.html');

createRoot(container).render(
  <StrictMode>
    <PidSchedStatApp />
  </StrictMode>,
);
