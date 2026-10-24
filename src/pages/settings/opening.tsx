import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { OpeningBalanceView } from 'src/sections/settings/opening-balance-view';

// ----------------------------------------------------------------------

const metadata = { title: `ยอดยกมา - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <OpeningBalanceView />
    </>
  );
}
