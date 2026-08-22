import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SysvipcMsgApp } from '../../SysvipcMsgApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from sysvipc/msg.html');

createRoot(container).render(
  <StrictMode>
    <SysvipcMsgApp />
  </StrictMode>,
);
