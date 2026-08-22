import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PidCgroupApp } from '../../PidCgroupApp';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from pid/cgroup.html');

createRoot(container).render(
  <StrictMode>
    <PidCgroupApp />
  </StrictMode>,
);
