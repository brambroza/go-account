import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { PurchaseNewView } from 'src/sections/purchases/view';

// ----------------------------------------------------------------------

const metadata = { title: `บันทึกซื้อ / ค่าใช้จ่าย - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <PurchaseNewView />
    </>
  );
}
