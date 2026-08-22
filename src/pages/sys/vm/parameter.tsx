import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SysVmParameterApp } from '../../../SysVmParameterApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from sys/vm/parameter.html');

createRoot(container).render(
  <StrictMode>
    <SysVmParameterApp />
  </StrictMode>,
);
