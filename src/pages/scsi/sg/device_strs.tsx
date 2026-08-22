import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ScsiSgDeviceStrsApp } from '../../../ScsiSgDeviceStrsApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from scsi/sg/device_strs.html');

createRoot(container).render(
  <StrictMode>
    <ScsiSgDeviceStrsApp />
  </StrictMode>,
);
