import { ProcPage } from './components/ProcPage';
import { VersionSignatureView } from './components/VersionSignatureView';
import { pageFor } from './pages';

const PAGE = pageFor('version_signature.html');

export function VersionSignatureApp() {
  return (
    <ProcPage page={PAGE}>
      {(content) => <VersionSignatureView content={content} />}
    </ProcPage>
  );
}
