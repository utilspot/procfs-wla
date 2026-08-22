import { LatencyStatsView } from './components/LatencyStatsView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('latency_stats.html');

export function LatencyStatsApp() {
  return (
    <ProcPage page={PAGE}>
      {(content) => <LatencyStatsView content={content} />}
    </ProcPage>
  );
}
