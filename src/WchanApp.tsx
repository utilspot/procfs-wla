import { ProcPage } from './components/ProcPage';
import { WchanView } from './components/WchanView';
import { pageFor } from './pages';

const PAGE = pageFor('pid/wchan.html');

export function WchanApp() {
  return <ProcPage page={PAGE}>{(content) => <WchanView content={content} />}</ProcPage>;
}
