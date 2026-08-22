import { ProcPage } from './components/ProcPage';
import { AsoundPcmView } from './components/AsoundPcmView';
import { pageFor } from './pages';

const PAGE = pageFor('asound/pcm.html');

export function AsoundPcmApp() {
  return <ProcPage page={PAGE}>{(content) => <AsoundPcmView content={content} />}</ProcPage>;
}
