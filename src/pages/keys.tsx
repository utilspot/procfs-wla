import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { KeysApp } from '../KeysApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from keys.html');

createRoot(container).render(
  <StrictMode>
    <KeysApp />
  </StrictMode>,
);
