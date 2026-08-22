import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { IrqDefaultSmpAffinityApp } from '../../IrqDefaultSmpAffinityApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from irq/default_smp_affinity.html');

createRoot(container).render(
  <StrictMode>
    <IrqDefaultSmpAffinityApp />
  </StrictMode>,
);
