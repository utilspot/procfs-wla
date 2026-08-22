import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PidStatApp } from '../../PidStatApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from pid/stat.html');

createRoot(container).render(
  <StrictMode>
    <PidStatApp />
  </StrictMode>,
);
