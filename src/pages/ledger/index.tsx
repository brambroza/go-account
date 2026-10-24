import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { LedgerView } from 'src/sections/ledger/view';

// ----------------------------------------------------------------------

const metadata = { title: `สมุดบัญชี / งบ - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <LedgerView />
    </>
  );
}
