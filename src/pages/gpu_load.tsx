import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GpuLoadApp } from '../GpuLoadApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from gpu_load.html');

createRoot(container).render(
  <StrictMode>
    <GpuLoadApp />
  </StrictMode>,
);
