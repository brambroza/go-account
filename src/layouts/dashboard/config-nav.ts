import { paths } from 'src/routes/paths';

// ----------------------------------------------------------------------

export type NavItem = {
  title: string;
  path: string;
  icon: string;
  /** keyword เพิ่มสำหรับค้นหา Ctrl+K */
  keywords?: string;
  /** active เฉพาะ path ตรงตัว (หน้าแรก) */
  exact?: boolean;
};

export type NavSection = { subheader: string; items: NavItem[] };

export const NAV: NavSection[] = [
  {
    subheader: 'งานประจำวัน',
    items: [
      { title: 'หน้าแรก', path: paths.dashboard, icon: 'solar:home-2-bold-duotone', exact: true },
      {
        title: 'ขาย / ใบกำกับภาษี',
        path: paths.sales.root,
        icon: 'solar:bill-list-bold-duotone',
        keywords: 'invoice ใบแจ้งหนี้ ลูกหนี้ รับชำระ ใบลดหนี้',
      },
      {
        title: 'ซื้อ / ค่าใช้จ่าย',
        path: paths.purchases.root,
        icon: 'solar:cart-large-2-bold-duotone',
        keywords: 'purchase expense เจ้าหนี้ จ่ายชำระ หัก ณ ที่จ่าย',
      },
      {
        title: 'ศูนย์ภาษี',
        path: paths.tax,
        icon: 'solar:document-text-bold-duotone',
        keywords: 'vat ภพ30 ภงด3 ภงด53 etax e-tax e-filing สรรพากร',
      },
    ],
  },
  {
    subheader: 'บัญชีและทะเบียน',
    items: [
      {
        title: 'สมุดบัญชี / งบ',
        path: paths.ledger,
        icon: 'solar:notebook-bold-duotone',
        keywords: 'journal gl งบทดลอง กำไรขาดทุน ผังบัญชี',
      },
      {
        title: 'ลูกค้า / ผู้ขาย',
        path: paths.contacts,
        icon: 'solar:users-group-rounded-bold-duotone',
        keywords: 'contact customer vendor import express csv',
      },
      {
        title: 'ตั้งค่าบริษัท',
        path: paths.settings,
        icon: 'solar:settings-bold-duotone',
        keywords: 'company setting เลขผู้เสียภาษี',
      },
    ],
  },
];

export const QUICK_ACTIONS: NavItem[] = [
  { title: 'ออกใบกำกับภาษีใหม่', path: paths.sales.new, icon: 'solar:add-circle-bold-duotone', keywords: 'new invoice' },
  { title: 'บันทึกซื้อ / ค่าใช้จ่ายใหม่', path: paths.purchases.new, icon: 'solar:add-circle-bold-duotone', keywords: 'new expense' },
];
