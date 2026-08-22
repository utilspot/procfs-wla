import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TtyDriversApp } from '../../TtyDriversApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from tty/drivers.html');

createRoot(container).render(
  <StrictMode>
    <TtyDriversApp />
  </StrictMode>,
);
