import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PidStackApp } from '../../PidStackApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from pid/stack.html');

createRoot(container).render(
  <StrictMode>
    <PidStackApp />
  </StrictMode>,
);
