import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { SalesDetailView } from 'src/sections/sales/view';

// ----------------------------------------------------------------------

const metadata = { title: `เอกสารขาย - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <SalesDetailView />
    </>
  );
}
