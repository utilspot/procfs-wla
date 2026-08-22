import { MountinfoView } from './components/MountinfoView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('pid/mountinfo.html');

export function MountinfoApp() {
  return <ProcPage page={PAGE}>{(content) => <MountinfoView content={content} />}</ProcPage>;
}
