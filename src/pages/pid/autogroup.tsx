import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AutogroupApp } from '../../AutogroupApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from pid/autogroup.html');

createRoot(container).render(
  <StrictMode>
    <AutogroupApp />
  </StrictMode>,
);
