import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MiscApp } from '../MiscApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from misc.html');

createRoot(container).render(
  <StrictMode>
    <MiscApp />
  </StrictMode>,
);
