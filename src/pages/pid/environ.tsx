import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PidEnvironApp } from '../../PidEnvironApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from pid/environ.html');

createRoot(container).render(
  <StrictMode>
    <PidEnvironApp />
  </StrictMode>,
);
