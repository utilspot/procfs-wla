import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ScsiSgAllowDioApp } from '../../../ScsiSgAllowDioApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from scsi/sg/allow_dio.html');

createRoot(container).render(
  <StrictMode>
    <ScsiSgAllowDioApp />
  </StrictMode>,
);
