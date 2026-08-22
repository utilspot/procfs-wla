import { ProcPage } from './components/ProcPage';
import { TimerListView } from './components/TimerListView';
import { pageFor } from './pages';

const PAGE = pageFor('timer_list.html');

export function TimerListApp() {
  return (
    <ProcPage page={PAGE}>{(content) => <TimerListView content={content} />}</ProcPage>
  );
}
