import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ScsiSgDevicesApp } from '../../../ScsiSgDevicesApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from scsi/sg/devices.html');

createRoot(container).render(
  <StrictMode>
    <ScsiSgDevicesApp />
  </StrictMode>,
);
