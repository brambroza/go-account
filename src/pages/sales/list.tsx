import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { SalesListView } from 'src/sections/sales/view';

// ----------------------------------------------------------------------

const metadata = { title: `ขาย / ใบกำกับภาษี - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <SalesListView />
    </>
  );
}
