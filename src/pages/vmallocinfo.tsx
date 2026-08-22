import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { VmallocInfoApp } from '../VmallocInfoApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from vmallocinfo.html');

createRoot(container).render(
  <StrictMode>
    <VmallocInfoApp />
  </StrictMode>,
);
