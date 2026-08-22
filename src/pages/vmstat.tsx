import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { VmstatApp } from '../VmstatApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from vmstat.html');

createRoot(container).render(
  <StrictMode>
    <VmstatApp />
  </StrictMode>,
);
