import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { PaymentView } from 'src/sections/purchases/view';

// ----------------------------------------------------------------------

const metadata = { title: `ใบสำคัญจ่าย / 50 ทวิ - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <PaymentView />
    </>
  );
}
