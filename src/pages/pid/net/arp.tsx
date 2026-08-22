import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NetArpApp } from '../../../NetArpApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from pid/net/arp.html');

createRoot(container).render(
  <StrictMode>
    <NetArpApp />
  </StrictMode>,
);
