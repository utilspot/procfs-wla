import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LatencyStatsApp } from '../LatencyStatsApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from latency_stats.html');

createRoot(container).render(
  <StrictMode>
    <LatencyStatsApp />
  </StrictMode>,
);
