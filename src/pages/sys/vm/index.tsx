import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SysVmIndexApp } from '../../../SysVmIndexApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from sys/vm/index.html');

createRoot(container).render(
  <StrictMode>
    <SysVmIndexApp />
  </StrictMode>,
);
