import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { UidMapApp } from '../../UidMapApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from pid/uid_map.html');

createRoot(container).render(
  <StrictMode>
    <UidMapApp />
  </StrictMode>,
);
