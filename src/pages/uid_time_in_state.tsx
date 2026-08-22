import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { UidTimeInStateApp } from '../UidTimeInStateApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from uid_time_in_state.html');

createRoot(container).render(
  <StrictMode>
    <UidTimeInStateApp />
  </StrictMode>,
);
