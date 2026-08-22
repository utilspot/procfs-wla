import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PidCoredumpFilterApp } from '../../PidCoredumpFilterApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from pid/coredump_filter.html');

createRoot(container).render(
  <StrictMode>
    <PidCoredumpFilterApp />
  </StrictMode>,
);
