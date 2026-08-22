import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ScsiSgDefReservedSizeApp } from '../../../ScsiSgDefReservedSizeApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from scsi/sg/def_reserved_size.html');

createRoot(container).render(
  <StrictMode>
    <ScsiSgDefReservedSizeApp />
  </StrictMode>,
);
