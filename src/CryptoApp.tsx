import { CryptoView } from './components/CryptoView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('crypto.html');

export function CryptoApp() {
  return <ProcPage page={PAGE}>{(content) => <CryptoView content={content} />}</ProcPage>;
}
