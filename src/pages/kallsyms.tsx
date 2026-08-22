import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { KallsymsApp } from '../KallsymsApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from kallsyms.html');

createRoot(container).render(
  <StrictMode>
    <KallsymsApp />
  </StrictMode>,
);
