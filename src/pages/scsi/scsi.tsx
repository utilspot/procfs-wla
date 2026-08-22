import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ScsiApp } from '../../ScsiApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from scsi/scsi.html');

createRoot(container).render(
  <StrictMode>
    <ScsiApp />
  </StrictMode>,
);
