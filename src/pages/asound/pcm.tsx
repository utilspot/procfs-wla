import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AsoundPcmApp } from '../../AsoundPcmApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from asound/pcm.html');

createRoot(container).render(
  <StrictMode>
    <AsoundPcmApp />
  </StrictMode>,
);
