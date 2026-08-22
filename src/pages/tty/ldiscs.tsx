import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TtyLdiscsApp } from '../../TtyLdiscsApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from tty/ldiscs.html');

createRoot(container).render(
  <StrictMode>
    <TtyLdiscsApp />
  </StrictMode>,
);
