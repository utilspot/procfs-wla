import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ScsiSgDeviceHdrApp } from '../../../ScsiSgDeviceHdrApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from scsi/sg/device_hdr.html');

createRoot(container).render(
  <StrictMode>
    <ScsiSgDeviceHdrApp />
  </StrictMode>,
);
