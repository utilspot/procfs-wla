import { ProcPage } from './components/ProcPage';
import { SessionIdView } from './components/SessionIdView';
import { pageFor } from './pages';

const PAGE = pageFor('pid/sessionid.html');

export function SessionIdApp() {
  return <ProcPage page={PAGE}>{(content) => <SessionIdView content={content} />}</ProcPage>;
}
