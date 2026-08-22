import { ExecDomainsView } from './components/ExecDomainsView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('execdomains.html');

export function ExecDomainsApp() {
  return (
    <ProcPage page={PAGE}>
      {(content) => <ExecDomainsView content={content} />}
    </ProcPage>
  );
}
