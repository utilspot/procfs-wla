import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CgroupsApp } from '../CgroupsApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from cgroups.html');

createRoot(container).render(
  <StrictMode>
    <CgroupsApp />
  </StrictMode>,
);
