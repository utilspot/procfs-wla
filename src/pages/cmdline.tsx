import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CmdlineApp } from '../CmdlineApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from cmdline.html');

createRoot(container).render(
  <StrictMode>
    <CmdlineApp />
  </StrictMode>,
);
