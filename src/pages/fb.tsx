import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FbApp } from '../FbApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from fb.html');

createRoot(container).render(
  <StrictMode>
    <FbApp />
  </StrictMode>,
);
