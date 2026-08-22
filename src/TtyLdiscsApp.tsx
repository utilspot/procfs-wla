import { ProcPage } from './components/ProcPage';
import { TtyLdiscsView } from './components/TtyLdiscsView';
import { pageFor } from './pages';

const PAGE = pageFor('tty/ldiscs.html');

export function TtyLdiscsApp() {
  return <ProcPage page={PAGE}>{(content) => <TtyLdiscsView content={content} />}</ProcPage>;
}
