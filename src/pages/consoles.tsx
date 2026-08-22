import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConsolesApp } from '../ConsolesApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from consoles.html');

createRoot(container).render(
  <StrictMode>
    <ConsolesApp />
  </StrictMode>,
);
