import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { CreditNoteView } from 'src/sections/sales/view';

// ----------------------------------------------------------------------

const metadata = { title: `ออกใบเพิ่มหนี้ - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <CreditNoteView mode="debit" />
    </>
  );
}
