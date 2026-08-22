import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GidMapApp } from '../../GidMapApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from pid/gid_map.html');

createRoot(container).render(
  <StrictMode>
    <GidMapApp />
  </StrictMode>,
);
