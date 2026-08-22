import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ModulesApp } from '../ModulesApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from modules.html');

createRoot(container).render(
  <StrictMode>
    <ModulesApp />
  </StrictMode>,
);
