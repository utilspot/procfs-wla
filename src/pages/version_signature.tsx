import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { VersionSignatureApp } from '../VersionSignatureApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from version_signature.html');

createRoot(container).render(
  <StrictMode>
    <VersionSignatureApp />
  </StrictMode>,
);
