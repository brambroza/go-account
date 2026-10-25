import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { VerifyEmailView } from 'src/sections/auth/verify-email-view';

// ----------------------------------------------------------------------

const metadata = { title: `ยืนยันอีเมล - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <VerifyEmailView />
    </>
  );
}
