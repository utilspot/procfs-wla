import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AsoundDevicesApp } from '../../AsoundDevicesApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from asound/devices.html');

createRoot(container).render(
  <StrictMode>
    <AsoundDevicesApp />
  </StrictMode>,
);
