import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { SettingsView } from 'src/sections/settings/view';

// ----------------------------------------------------------------------

const metadata = { title: `ตั้งค่าบริษัท - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <SettingsView />
    </>
  );
}
