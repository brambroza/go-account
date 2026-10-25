import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { ResetPasswordView } from 'src/sections/auth/reset-password-view';

// ----------------------------------------------------------------------

const metadata = { title: `ตั้งรหัสผ่านใหม่ - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <ResetPasswordView />
    </>
  );
}
