import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StatApp } from '../StatApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from stat.html');

createRoot(container).render(
  <StrictMode>
    <StatApp />
  </StrictMode>,
);
