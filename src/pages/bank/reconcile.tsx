import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { BankReconcileView } from 'src/sections/bank/view';

// ----------------------------------------------------------------------

const metadata = { title: `กระทบยอดธนาคาร - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <BankReconcileView />
    </>
  );
}
