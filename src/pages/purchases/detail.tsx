import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { PurchaseDetailView } from 'src/sections/purchases/view';

// ----------------------------------------------------------------------

const metadata = { title: `เอกสารซื้อ - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <PurchaseDetailView />
    </>
  );
}
