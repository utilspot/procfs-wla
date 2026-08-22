import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FilesystemsApp } from '../FilesystemsApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from filesystems.html');

createRoot(container).render(
  <StrictMode>
    <FilesystemsApp />
  </StrictMode>,
);
