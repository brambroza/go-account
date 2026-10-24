// date pickers (MUI) — ระบบไม่ใช้ DataGrid จึงไม่ import locale ของ DataGrid (ลด bundle)
import { enUS as enUSDate } from '@mui/x-date-pickers/locales';

// ----------------------------------------------------------------------

/**
 * ภาษาที่รองรับ — เพิ่มภาษาใหม่ต้องเพิ่มที่ `config-locales.ts` และ `langs/<lang>/*.json` ด้วย
 * `systemValue` คือ locale ของ MUI component ที่ส่งเข้า `createTheme` ใน theme-provider
 */
export const allLangs = [
  {
    value: 'th',
    label: 'Thai',
    countryCode: 'TH',
    adapterLocale: 'th',
    numberFormat: { code: 'th-Th', currency: 'THB' },
    systemValue: {
      components: { ...enUSDate.components },
    },
  },
  {
    value: 'en',
    label: 'English',
    countryCode: 'GB',
    adapterLocale: 'en',
    numberFormat: { code: 'en-US', currency: 'USD' },
    systemValue: {
      components: { ...enUSDate.components },
    },
  },
];

/**
 * Country code:
 * https://flagcdn.com/en/codes.json
 *
 * Number format code:
 * https://gist.github.com/raushankrjha/d1c7e35cf87e69aa8b4208a8171a8416
 */
