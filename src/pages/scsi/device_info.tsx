import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ScsiDeviceInfoApp } from '../../ScsiDeviceInfoApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from scsi/device_info.html');

createRoot(container).render(
  <StrictMode>
    <ScsiDeviceInfoApp />
  </StrictMode>,
);
