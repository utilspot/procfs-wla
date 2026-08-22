import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DirApp } from '../DirApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from dir.html');

createRoot(container).render(
  <StrictMode>
    <DirApp />
  </StrictMode>,
);
