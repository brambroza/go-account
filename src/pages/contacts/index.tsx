import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { ContactsView } from 'src/sections/contacts/view';

// ----------------------------------------------------------------------

const metadata = { title: `ลูกค้า / ผู้ขาย - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <ContactsView />
    </>
  );
}
