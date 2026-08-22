import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { InterruptsApp } from '../InterruptsApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from interrupts.html');

createRoot(container).render(
  <StrictMode>
    <InterruptsApp />
  </StrictMode>,
);
