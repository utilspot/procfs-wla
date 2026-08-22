import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TimerListApp } from '../TimerListApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from timer_list.html');

createRoot(container).render(
  <StrictMode>
    <TimerListApp />
  </StrictMode>,
);
