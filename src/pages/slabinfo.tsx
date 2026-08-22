import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SlabInfoApp } from '../SlabInfoApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from slabinfo.html');

createRoot(container).render(
  <StrictMode>
    <SlabInfoApp />
  </StrictMode>,
);
