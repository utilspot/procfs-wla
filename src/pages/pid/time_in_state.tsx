import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PidTimeInStateApp } from '../../PidTimeInStateApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from pid/time_in_state.html');

createRoot(container).render(
  <StrictMode>
    <PidTimeInStateApp />
  </StrictMode>,
);
