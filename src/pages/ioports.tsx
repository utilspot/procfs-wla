import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { IoportsApp } from '../IoportsApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from ioports.html');

createRoot(container).render(
  <StrictMode>
    <IoportsApp />
  </StrictMode>,
);
