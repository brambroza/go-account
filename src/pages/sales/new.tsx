import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { SalesNewView } from 'src/sections/sales/view';

// ----------------------------------------------------------------------

const metadata = { title: `ออกใบกำกับภาษี - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <SalesNewView />
    </>
  );
}
