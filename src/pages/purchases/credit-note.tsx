import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { SupplierCreditNoteView } from 'src/sections/purchases/view';

// ----------------------------------------------------------------------

const metadata = { title: `ใบลดหนี้จากผู้ขาย - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <SupplierCreditNoteView />
    </>
  );
}
