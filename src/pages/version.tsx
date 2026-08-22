import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { VersionApp } from '../VersionApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from version.html');

createRoot(container).render(
  <StrictMode>
    <VersionApp />
  </StrictMode>,
);
