import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AsoundModulesApp } from '../../AsoundModulesApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from asound/modules.html');

createRoot(container).render(
  <StrictMode>
    <AsoundModulesApp />
  </StrictMode>,
);
