import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DriverRtcApp } from '../../DriverRtcApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from driver/rtc.html');

createRoot(container).render(
  <StrictMode>
    <DriverRtcApp />
  </StrictMode>,
);
