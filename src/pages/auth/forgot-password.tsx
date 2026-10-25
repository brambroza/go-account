import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { ForgotPasswordView } from 'src/sections/auth/forgot-password-view';

// ----------------------------------------------------------------------

const metadata = { title: `ลืมรหัสผ่าน - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <ForgotPasswordView />
    </>
  );
}
