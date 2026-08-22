import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MdstatApp } from '../MdstatApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from mdstat.html');

createRoot(container).render(
  <StrictMode>
    <MdstatApp />
  </StrictMode>,
);
