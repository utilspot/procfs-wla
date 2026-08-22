import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SysvipcShmApp } from '../../SysvipcShmApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from sysvipc/shm.html');

createRoot(container).render(
  <StrictMode>
    <SysvipcShmApp />
  </StrictMode>,
);
