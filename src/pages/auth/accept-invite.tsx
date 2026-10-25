import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { AcceptInviteView } from 'src/sections/auth/accept-invite-view';

// ----------------------------------------------------------------------

const metadata = { title: `ตอบรับคำเชิญ - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <AcceptInviteView />
    </>
  );
}
