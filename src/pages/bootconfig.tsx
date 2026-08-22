import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BootConfigApp } from '../BootConfigApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from bootconfig.html');

createRoot(container).render(
  <StrictMode>
    <BootConfigApp />
  </StrictMode>,
);
