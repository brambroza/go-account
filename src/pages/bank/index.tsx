import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { BankView } from 'src/sections/bank/view';

// ----------------------------------------------------------------------

const metadata = { title: `ธนาคาร / เงินสด - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <BankView />
    </>
  );
}
