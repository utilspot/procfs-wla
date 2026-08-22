import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MeminfoApp } from '../MeminfoApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from meminfo.html');

createRoot(container).render(
  <StrictMode>
    <MeminfoApp />
  </StrictMode>,
);
