import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ScsiSgVersionApp } from '../../../ScsiSgVersionApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from scsi/sg/version.html');

createRoot(container).render(
  <StrictMode>
    <ScsiSgVersionApp />
  </StrictMode>,
);
