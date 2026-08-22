import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BuddyInfoApp } from '../BuddyInfoApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from buddyinfo.html');

createRoot(container).render(
  <StrictMode>
    <BuddyInfoApp />
  </StrictMode>,
);
