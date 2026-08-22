import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SysvipcSemApp } from '../../SysvipcSemApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from sysvipc/sem.html');

createRoot(container).render(
  <StrictMode>
    <SysvipcSemApp />
  </StrictMode>,
);
