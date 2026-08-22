import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PartitionsApp } from '../PartitionsApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from partitions.html');

createRoot(container).render(
  <StrictMode>
    <PartitionsApp />
  </StrictMode>,
);
