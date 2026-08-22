import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminApp } from '../AdminApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from admin.html');

createRoot(container).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
);
