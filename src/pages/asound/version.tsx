import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AsoundVersionApp } from '../../AsoundVersionApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from asound/version.html');

createRoot(container).render(
  <StrictMode>
    <AsoundVersionApp />
  </StrictMode>,
);
