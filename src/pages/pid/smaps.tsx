import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SmapsApp } from '../../SmapsApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from pid/smaps.html');

createRoot(container).render(
  <StrictMode>
    <SmapsApp />
  </StrictMode>,
);
