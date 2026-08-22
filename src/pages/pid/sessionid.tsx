import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SessionIdApp } from '../../SessionIdApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from pid/sessionid.html');

createRoot(container).render(
  <StrictMode>
    <SessionIdApp />
  </StrictMode>,
);
