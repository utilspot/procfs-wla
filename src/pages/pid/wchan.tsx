import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WchanApp } from '../../WchanApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from pid/wchan.html');

createRoot(container).render(
  <StrictMode>
    <WchanApp />
  </StrictMode>,
);
