import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DmaApp } from '../DmaApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from dma.html');

createRoot(container).render(
  <StrictMode>
    <DmaApp />
  </StrictMode>,
);
