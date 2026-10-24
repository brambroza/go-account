import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { LoginView } from 'src/sections/auth/login-view';

// ----------------------------------------------------------------------

const metadata = { title: `เข้าสู่ระบบ - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <LoginView />
    </>
  );
}
