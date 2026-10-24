import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { QuotationFormView } from 'src/sections/quotations/view';

// ----------------------------------------------------------------------

const metadata = { title: `แก้ไขใบเสนอราคา - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <QuotationFormView />
    </>
  );
}
