import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SysUserIndexApp } from '../../../SysUserIndexApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from sys/user/index.html');

createRoot(container).render(
  <StrictMode>
    <SysUserIndexApp />
  </StrictMode>,
);
