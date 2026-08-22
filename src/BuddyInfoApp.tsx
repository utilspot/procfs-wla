import { BuddyInfoView } from './components/BuddyInfoView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('buddyinfo.html');

export function BuddyInfoApp() {
  return (
    <ProcPage page={PAGE}>{(content) => <BuddyInfoView content={content} />}</ProcPage>
  );
}
