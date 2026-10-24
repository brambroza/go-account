import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { SignupView } from 'src/sections/auth/signup-view';

// ----------------------------------------------------------------------

const metadata = { title: `สมัครใช้งาน - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <SignupView />
    </>
  );
}
