import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MountsApp } from '../MountsApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from mounts.html');

createRoot(container).render(
  <StrictMode>
    <MountsApp />
  </StrictMode>,
);
