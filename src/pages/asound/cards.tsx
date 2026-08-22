import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AsoundCardsApp } from '../../AsoundCardsApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from asound/cards.html');

createRoot(container).render(
  <StrictMode>
    <AsoundCardsApp />
  </StrictMode>,
);
