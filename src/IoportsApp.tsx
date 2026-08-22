import { IoportsView } from './components/IoportsView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('ioports.html');

export function IoportsApp() {
  return (
    <ProcPage page={PAGE}>{(content) => <IoportsView content={content} />}</ProcPage>
  );
}
