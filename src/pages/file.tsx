import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RawApp } from '../RawApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from file.html');

createRoot(container).render(
  <StrictMode>
    <RawApp />
  </StrictMode>,
);
