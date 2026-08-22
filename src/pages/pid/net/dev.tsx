import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NetDevApp } from '../../../NetDevApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from pid/net/dev.html');

createRoot(container).render(
  <StrictMode>
    <NetDevApp />
  </StrictMode>,
);
