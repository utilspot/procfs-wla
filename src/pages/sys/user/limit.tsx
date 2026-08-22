import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SysUserUcountApp } from '../../../SysUserUcountApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from sys/user/limit.html');

createRoot(container).render(
  <StrictMode>
    <SysUserUcountApp />
  </StrictMode>,
);
