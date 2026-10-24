import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { MembersView } from 'src/sections/settings/members-view';

// ----------------------------------------------------------------------

const metadata = { title: `ผู้ใช้งาน - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <MembersView />
    </>
  );
}
