import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GpuMemoryApp } from '../GpuMemoryApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from gpu_memory.html');

createRoot(container).render(
  <StrictMode>
    <GpuMemoryApp />
  </StrictMode>,
);
