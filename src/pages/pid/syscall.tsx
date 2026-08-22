import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SyscallApp } from '../../SyscallApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from pid/syscall.html');

createRoot(container).render(
  <StrictMode>
    <SyscallApp />
  </StrictMode>,
);
