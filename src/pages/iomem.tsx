import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { IomemApp } from '../IomemApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from iomem.html');

createRoot(container).render(
  <StrictMode>
    <IomemApp />
  </StrictMode>,
);
