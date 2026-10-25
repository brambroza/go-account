import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { QuotationFormView } from 'src/sections/quotations/view';

// ----------------------------------------------------------------------

const metadata = { title: `สร้างใบเสนอราคา - ${CONFIG.site.name}` };

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
