import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MountinfoApp } from '../../MountinfoApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from pid/mountinfo.html');

createRoot(container).render(
  <StrictMode>
    <MountinfoApp />
  </StrictMode>,
);
