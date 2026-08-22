import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PidMapsApp } from '../../PidMapsApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from pid/maps.html');

createRoot(container).render(
  <StrictMode>
    <PidMapsApp />
  </StrictMode>,
);
