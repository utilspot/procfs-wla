import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PageTypeInfoApp } from '../PageTypeInfoApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from pagetypeinfo.html');

createRoot(container).render(
  <StrictMode>
    <PageTypeInfoApp />
  </StrictMode>,
);
