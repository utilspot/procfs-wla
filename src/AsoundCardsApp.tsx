import { ProcPage } from './components/ProcPage';
import { AsoundCardsView } from './components/AsoundCardsView';
import { pageFor } from './pages';

const PAGE = pageFor('asound/cards.html');

export function AsoundCardsApp() {
  return <ProcPage page={PAGE}>{(content) => <AsoundCardsView content={content} />}</ProcPage>;
}
