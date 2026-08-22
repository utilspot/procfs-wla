import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SwapsApp } from '../SwapsApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from swaps.html');

createRoot(container).render(
  <StrictMode>
    <SwapsApp />
  </StrictMode>,
);
