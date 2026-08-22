import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuxvApp } from '../../AuxvApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from pid/auxv.html');

createRoot(container).render(
  <StrictMode>
    <AuxvApp />
  </StrictMode>,
);
