import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { KeyUsersApp } from '../KeyUsersApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from key-users.html');

createRoot(container).render(
  <StrictMode>
    <KeyUsersApp />
  </StrictMode>,
);
