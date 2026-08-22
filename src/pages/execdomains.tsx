import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ExecDomainsApp } from '../ExecDomainsApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from execdomains.html');

createRoot(container).render(
  <StrictMode>
    <ExecDomainsApp />
  </StrictMode>,
);
