import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { QuotationListView } from 'src/sections/quotations/view';

// ----------------------------------------------------------------------

const metadata = { title: `ใบเสนอราคา - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <QuotationListView />
    </>
  );
}
