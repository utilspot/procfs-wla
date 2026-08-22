import { BootConfigView } from './components/BootConfigView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('bootconfig.html');

export function BootConfigApp() {
  return (
    <ProcPage page={PAGE}>{(content) => <BootConfigView content={content} />}</ProcPage>
  );
}
