import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NetConnectorApp } from '../../../NetConnectorApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from pid/net/connector.html');

createRoot(container).render(
  <StrictMode>
    <NetConnectorApp />
  </StrictMode>,
);
