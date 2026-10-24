import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { TaxView } from 'src/sections/tax/view';

// ----------------------------------------------------------------------

const metadata = { title: `ศูนย์ภาษี - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <TaxView />
    </>
  );
}
