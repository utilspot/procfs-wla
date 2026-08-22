import { KeyUsersView } from './components/KeyUsersView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('key-users.html');

export function KeyUsersApp() {
  return (
    <ProcPage page={PAGE}>{(content) => <KeyUsersView content={content} />}</ProcPage>
  );
}
