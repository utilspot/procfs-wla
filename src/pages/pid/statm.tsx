import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PidStatmApp } from '../../PidStatmApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from pid/statm.html');

createRoot(container).render(
  <StrictMode>
    <PidStatmApp />
  </StrictMode>,
);
